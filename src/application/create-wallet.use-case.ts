import { InvalidMoneyError } from '../domain/errors.js';
import { Money, type MoneyProps } from '../domain/money.js';
import { WagerTransaction } from '../domain/wager-transaction.js';
import { Wallet } from '../domain/wallet.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { toWalletRow } from '../infra/database/wallet.mapper.js';
import { toWagerTransactionRow } from '../infra/database/wager-transaction.mapper.js';
import { toWalletLedgerEntryRow } from '../infra/database/wallet-ledger-entry.mapper.js';
import { toOutboxMessageRow } from '../infra/database/outbox-message.mapper.js';
import { OutboxMessage } from '../domain/outbox-message.js';
import { WalletBalanceChanged } from '../domain/events/wallet-balance-changed.js';
import { WagerTransactionProcessed } from '../domain/events/wager-transaction-processed.js';
import {
  WalletLedgerEntrySchema,
  WagerTransactionSchema,
  OutboxMessageSchema,
  WalletSchema,
} from '../infra/database/schemas.js';
import { PayloadValidationError, WalletAlreadyExistsError } from './errors.js';
import type { LoggerPort } from './ports/logger.port.js';
import { uniqueViolationOf } from './wallet-lock.js';

export interface CreateWalletCommand {
  playerId: unknown;
  initialBalance: unknown;
  correlationId: string;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

/**
 * Cria a wallet do jogador (uma por playerId + currency). Saldo inicial
 * positivo gera a transação interna OPENING e o lançamento CREDIT na mesma
 * transação SQL da wallet, com os eventos na outbox.
 */
export class CreateWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly logger: LoggerPort,
  ) {}

  async execute(cmd: CreateWalletCommand): Promise<CreateWalletResult> {
    const playerId = this.assertFilled(cmd.playerId, 'playerId');
    const money = this.parseInitialBalance(cmd.initialBalance);
    const now = new Date();
    const walletId = Bun.randomUUIDv7();

    const openingIds = money.isPositive()
      ? { entryId: Bun.randomUUIDv7(), transactionId: Bun.randomUUIDv7() }
      : undefined;

    const { wallet, openingEntry } = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: money,
      opening: openingIds,
      now,
    });

    const openingTransaction =
      openingEntry !== undefined && openingIds !== undefined
        ? WagerTransaction.createOpening({
            id: openingIds.transactionId,
            walletId,
            playerId,
            money,
            createdAt: now,
          })
        : undefined;

    try {
      await this.em.transactional(async (tem) => {
        await tem.insert(WalletSchema, toWalletRow(wallet));

        if (openingTransaction !== undefined && openingEntry !== undefined) {
          await tem.insert(WagerTransactionSchema, toWagerTransactionRow(openingTransaction));
          await tem.insert(WalletLedgerEntrySchema, toWalletLedgerEntryRow(openingEntry));
        }

        // Eventos da abertura entram na mesma transação da wallet.
        const eventCtx = { eventId: Bun.randomUUIDv7(), correlationId: cmd.correlationId, occurredAt: now };
        const events = [];
        if (openingTransaction !== undefined && openingEntry !== undefined) {
          events.push(
            WagerTransactionProcessed.from(openingTransaction, wallet.balance, eventCtx),
            WalletBalanceChanged.from(wallet, openingEntry, eventCtx),
          );
        }
        for (const event of events) {
          await tem.insert(
            OutboxMessageSchema,
            toOutboxMessageRow(OutboxMessage.enqueue(event, { id: Bun.randomUUIDv7() })),
          );
        }
      });
    } catch (error) {
      const violation = uniqueViolationOf(error);
      if (violation?.constraint.startsWith('wallets')) {
        throw new WalletAlreadyExistsError(playerId, money.currency);
      }
      throw error;
    }

    this.logger.info('wallet_created', {
      walletId: wallet.id,
      playerId,
      hasOpening: openingTransaction !== undefined,
    });

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }

  private assertFilled(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new PayloadValidationError([`${field} is required`]);
    }
    return value.trim();
  }

  private parseInitialBalance(value: unknown): Money {
    const raw = value as { amount?: unknown; currency?: unknown } | undefined;
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof raw.amount !== 'string' ||
      typeof raw.currency !== 'string'
    ) {
      throw new PayloadValidationError([
        'initialBalance must be an object with amount and currency strings',
      ]);
    }
    try {
      return Money.from({ amount: raw.amount.trim(), currency: raw.currency.trim() });
    } catch (error) {
      if (error instanceof InvalidMoneyError) {
        throw new PayloadValidationError([error.message]);
      }
      throw error;
    }
  }
}
