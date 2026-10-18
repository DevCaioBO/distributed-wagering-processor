import type { EntityManager } from '@mikro-orm/postgresql';
import { InsufficientFundsError } from '../domain/errors.js';
import { FailureCode } from '../domain/failure-code.js';
import type { IntegrationEvent } from '../domain/events/integration-event.js';
import { WagerTransactionPendingReference } from '../domain/events/wager-transaction-pending-reference.js';
import { WagerTransactionProcessed } from '../domain/events/wager-transaction-processed.js';
import { WagerTransactionRejected } from '../domain/events/wager-transaction-rejected.js';
import { WalletBalanceChanged } from '../domain/events/wallet-balance-changed.js';
import type { Money, MoneyProps } from '../domain/money.js';
import { OutboxMessage } from '../domain/outbox-message.js';
import { Wallet, type ApplyMovementInput } from '../domain/wallet.js';
import { LedgerDirection, WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction.js';
import type { WagerTransactionRow } from '../infra/database/rows.js';
import {
  OutboxMessageSchema,
  WalletLedgerEntrySchema,
  WalletSchema,
  WagerTransactionSchema,
} from '../infra/database/schemas.js';
import { toWallet, toWalletRow } from '../infra/database/wallet.mapper.js';
import { toWalletLedgerEntryRow } from '../infra/database/wallet-ledger-entry.mapper.js';
import { toWagerTransaction } from '../infra/database/wager-transaction.mapper.js';
import type { LoggerPort } from './ports/logger.port.js';
import type { MetricsPort } from './ports/metrics.port.js';
import { referenceBackoffMs, type WageringConfig } from './wagering-config.js';
import { lockWalletForUpdate } from './wallet-lock.js';

export interface ProcessContext {
  now: Date;
  correlationId: string;
  source: string;
  /** Tentativas já consumidas — só no reprocessamento de PENDING_REFERENCE. */
  referenceAttempts?: number;
}

export interface ProcessOutcome {
  status: WagerTransactionStatus;
  transactionId: string;
  failureCode?: FailureCode;
  /** Saldo observado; undefined quando a wallet não existe. */
  balance?: MoneyProps;
  nextAttemptAt?: Date;
}

/**
 * Aplica uma transação de aposta sobre a wallet. Usado pelo envio HTTP/fila
 * (transação recém-criada em PENDING) e pelo worker de referências fora de
 * ordem (transação em PENDING_REFERENCE).
 *
 * A linha da transação já deve existir na transação atual. Todo o efeito —
 * status da transação, saldo, ledger e outbox — é persistido na mesma
 * transação SQL; o caller só vê o resultado depois do commit.
 */
export class TransactionProcessor {
  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsPort,
    private readonly logger: LoggerPort,
    private readonly config: WageringConfig,
  ) {}

  async process(
    transaction: WagerTransaction,
    ctx: ProcessContext,
  ): Promise<ProcessOutcome> {
    const walletRow = await lockWalletForUpdate(this.em, transaction.walletId, this.metrics);
    if (walletRow === null) {
      return this.reject(transaction, FailureCode.WalletNotFound, undefined, ctx);
    }
    const wallet = toWallet(walletRow);

    if (wallet.playerId !== transaction.playerId) {
      return this.reject(transaction, FailureCode.WalletPlayerMismatch, wallet, ctx);
    }
    if (transaction.money.currency !== wallet.currency) {
      return this.reject(transaction, FailureCode.CurrencyMismatch, wallet, ctx);
    }

    let reference: WagerTransaction | undefined;
    if (transaction.referenceExternalTransactionId !== undefined) {
      const referenceRow = (await this.em.findOne(WagerTransactionSchema, {
        providerId: transaction.providerId,
        externalTransactionId: transaction.referenceExternalTransactionId,
      })) as WagerTransactionRow | null;

      if (referenceRow === null) {
        return this.pendingReference(transaction, wallet, ctx);
      }

      reference = toWagerTransaction(referenceRow);
      const referenceCode = transaction.validateReference(reference);
      if (referenceCode !== undefined) {
        return this.reject(transaction, referenceCode, wallet, ctx);
      }
      if (reference.status !== WagerTransactionStatus.Processed) {
        return this.reject(transaction, FailureCode.ReferenceNotProcessed, wallet, ctx);
      }
      const priorReversal = await this.em.findOne(WagerTransactionSchema, {
        referenceTransactionId: reference.id,
        kind: transaction.kind,
        status: WagerTransactionStatus.Processed,
      });
      if (priorReversal !== null) {
        return this.reject(transaction, FailureCode.AlreadyReversed, wallet, ctx);
      }
    }

    // LOSS registra o resultado sem mover saldo e sem gerar lançamento.
    if (!transaction.affectsBalance()) {
      transaction.markProcessed(reference?.id, ctx.now);
      await this.persistTransaction(transaction, wallet.balance);
      await this.enqueueEvents([
        WagerTransactionProcessed.from(transaction, wallet.balance, this.eventCtx(ctx)),
      ]);
      this.logger.info('wager_transaction_processed', {
        transactionId: transaction.id,
        walletId: transaction.walletId,
        providerId: transaction.providerId,
        kind: transaction.kind,
        status: transaction.status,
        source: ctx.source,
      });
      return {
        status: transaction.status,
        transactionId: transaction.id,
        balance: wallet.balance.toJSON(),
      };
    }

    const direction = transaction.ledgerDirectionFor(reference);
    let entry: WalletLedgerEntry;
    try {
      entry = this.applyMovement(wallet, direction, transaction, ctx);
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        const failureCode =
          transaction.kind === WagerTransactionKind.Rollback
            ? FailureCode.ReversalWouldOverdraw
            : FailureCode.InsufficientFunds;
        return this.reject(transaction, failureCode, wallet, ctx);
      }
      throw error;
    }

    transaction.markProcessed(reference?.id, ctx.now);
    await this.em.nativeUpdate(WalletSchema, { id: wallet.id }, toWalletRow(wallet));
    await this.em.insert(WalletLedgerEntrySchema, toWalletLedgerEntryRow(entry));
    await this.persistTransaction(transaction, wallet.balance);
    await this.enqueueEvents([
      WagerTransactionProcessed.from(transaction, wallet.balance, this.eventCtx(ctx)),
      WalletBalanceChanged.from(wallet, entry, this.eventCtx(ctx)),
    ]);
    this.logger.info('wager_transaction_processed', {
      transactionId: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      kind: transaction.kind,
      status: transaction.status,
      direction,
      source: ctx.source,
    });
    return {
      status: transaction.status,
      transactionId: transaction.id,
      balance: wallet.balance.toJSON(),
    };
  }

  private applyMovement(
    wallet: Wallet,
    direction: LedgerDirection,
    transaction: WagerTransaction,
    ctx: ProcessContext,
  ): WalletLedgerEntry {
    const input: ApplyMovementInput = {
      entryId: Bun.randomUUIDv7(),
      transactionId: transaction.id,
      money: transaction.money,
      now: ctx.now,
    };
    return direction === LedgerDirection.Debit ? wallet.debit(input) : wallet.credit(input);
  }

  /**
   * Referência ausente: persiste PENDING_REFERENCE com o próximo retry
   * agendado (backoff exponencial). No reprocessamento, esgotado o limite de
   * tentativas, rejeita com REFERENCE_NOT_FOUND.
   */
  private async pendingReference(
    transaction: WagerTransaction,
    wallet: Wallet,
    ctx: ProcessContext,
  ): Promise<ProcessOutcome> {
    const attempts = (ctx.referenceAttempts ?? 0) + 1;

    if (attempts >= this.config.referenceMaxAttempts) {
      return this.reject(transaction, FailureCode.ReferenceNotFound, wallet, ctx);
    }

    transaction.markPendingReference();
    const nextAttemptAt = new Date(
      ctx.now.getTime() + referenceBackoffMs(this.config.referenceRetryBaseMs, attempts),
    );
    await this.em.nativeUpdate(
      WagerTransactionSchema,
      { id: transaction.id },
      {
        status: transaction.status,
        balanceAfter: wallet.balance.toJSON().amount,
        referenceAttempts: attempts,
        nextAttemptAt,
      },
    );
    await this.enqueueEvents([
      WagerTransactionPendingReference.from(transaction, this.eventCtx(ctx)),
    ]);
    this.metrics.countReferenceRetry(false);
    this.logger.info('wager_transaction_pending_reference', {
      transactionId: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      kind: transaction.kind,
      referenceAttempts: attempts,
      source: ctx.source,
    });
    return {
      status: transaction.status,
      transactionId: transaction.id,
      balance: wallet.balance.toJSON(),
      nextAttemptAt,
    };
  }

  private async reject(
    transaction: WagerTransaction,
    failureCode: FailureCode,
    wallet: Wallet | undefined,
    ctx: ProcessContext,
  ): Promise<ProcessOutcome> {
    transaction.reject(failureCode);
    await this.em.nativeUpdate(
      WagerTransactionSchema,
      { id: transaction.id },
      {
        status: transaction.status,
        failureCode: transaction.failureCode,
        processedAt: null,
        referenceTransactionId: transaction.referenceTransactionId ?? null,
        balanceAfter: wallet?.balance.toJSON().amount ?? null,
      },
    );
    await this.enqueueEvents([WagerTransactionRejected.from(transaction, this.eventCtx(ctx))]);
    this.metrics.countRejection(failureCode);
    if (failureCode === FailureCode.ReferenceNotFound) {
      this.metrics.countReferenceRetry(true);
    }
    this.logger.warn('wager_transaction_rejected', {
      transactionId: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      kind: transaction.kind,
      failureCode,
      source: ctx.source,
    });
    return {
      status: transaction.status,
      transactionId: transaction.id,
      failureCode,
      balance: wallet?.balance.toJSON(),
    };
  }

  private async persistTransaction(transaction: WagerTransaction, balance: Money) {
    await this.em.nativeUpdate(
      WagerTransactionSchema,
      { id: transaction.id },
      {
        status: transaction.status,
        failureCode: null,
        referenceTransactionId: transaction.referenceTransactionId ?? null,
        processedAt: transaction.processedAt ?? null,
        balanceAfter: balance.toJSON().amount,
      },
    );
  }

  private async enqueueEvents(events: IntegrationEvent<unknown>[]) {
    for (const event of events) {
      const outbox = OutboxMessage.enqueue(event, { id: Bun.randomUUIDv7() });
      await this.em.insert(OutboxMessageSchema, {
        id: outbox.id,
        aggregateId: outbox.aggregateId,
        eventType: outbox.eventType,
        payload: { ...outbox.payload },
        occurredAt: outbox.occurredAt,
        attempts: outbox.attempts,
        nextAttemptAt: null,
        publishedAt: null,
      });
    }
  }

  private eventCtx(ctx: ProcessContext) {
    return {
      eventId: Bun.randomUUIDv7(),
      correlationId: ctx.correlationId,
      occurredAt: ctx.now,
    };
  }
}
