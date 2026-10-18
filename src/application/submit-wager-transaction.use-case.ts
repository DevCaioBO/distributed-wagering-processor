import type { EntityManager } from '@mikro-orm/postgresql';
import { FailureCode } from '../domain/failure-code.js';
import { InboxMessage } from '../domain/inbox-message.js';
import { WagerTransactionStatus, WagerTransaction } from '../domain/wager-transaction.js';
import type { MoneyProps } from '../domain/money.js';
import type { WagerTransactionRow } from '../infra/database/rows.js';
import {
  InboxMessageSchema,
  WagerTransactionSchema,
} from '../infra/database/schemas.js';
import { toInboxMessageRow } from '../infra/database/inbox-message.mapper.js';
import { toWagerTransactionRow } from '../infra/database/wager-transaction.mapper.js';
import {
  IdempotencyConflictError,
  PayloadValidationError,
} from './errors.js';
import { payloadHashOf, hashRawBody } from './payload-hash.js';
import type { LoggerPort } from './ports/logger.port.js';
import type { MetricsPort } from './ports/metrics.port.js';
import { parseSubmitPayload, type ParsedSubmitPayload } from './submit-payload.js';
import { TransactionProcessor } from './transaction-processor.js';
import type { WageringConfig } from './wagering-config.js';
import { isLockConflict, uniqueViolationOf } from './wallet-lock.js';

export interface SubmitWagerTransactionCommand {
  /** Fonte da verdade da idempotência (header no HTTP, data.idempotencyKey na fila). */
  idempotencyKey: string;
  correlationId: string;
  source: 'HTTP' | 'SQS';
  /** Presente quando a entrada vem da fila: dedup persistente na inbox. */
  inbox?: { consumerName: string; messageId: string };
  /** Payload bruto (validado dentro do caso de uso). */
  payload: unknown;
}

export interface SubmitWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  /** Saldo observado no momento; undefined quando a wallet não existe. */
  balance?: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

/**
 * Submete uma operação de aposta. Caminho feliz:
 *
 * 1. valida o payload (erros são terminais: provedor deve corrigir);
 * 2. na entrada via fila, deduplica na inbox — a linha só é commitada junto
 *    com o efeito, então redelivery não duplica nada;
 * 3. INSERT da transação em PENDING: a unicidade (provider_id, idempotency_key)
 *    no banco é o árbitro da concorrência — replay devolve o resultado
 *    original, payload divergente vira conflito;
 * 4. lock `FOR UPDATE` da wallet (unidade de concorrência), aplicação das
 *    regras e persistência de saldo, ledger, transação e outbox na mesma
 *    transação SQL.
 */
export class SubmitWagerTransactionUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsPort,
    private readonly logger: LoggerPort,
    private readonly config: WageringConfig,
  ) {}

  async execute(cmd: SubmitWagerTransactionCommand): Promise<SubmitWagerTransactionResult> {
    const parsed = parseSubmitPayload(cmd.payload);
    const idempotencyKey = this.assertKey(cmd.idempotencyKey);
    const payloadHash = payloadHashOf(parsed);
    const startedAt = performance.now();

    try {
      const result = await this.em.transactional((tem) =>
        this.processInTransaction(tem, cmd, parsed, idempotencyKey, payloadHash),
      );
      this.metrics.countTransaction(result.status, parsed.kind, cmd.source);
      this.metrics.observeProcessingDuration(cmd.source, performance.now() - startedAt);
      return result;
    } catch (error) {
      if (isLockConflict(error)) {
        this.metrics.countLockConflict();
      }
      const violation = uniqueViolationOf(error);
      if (violation !== null) {
        const resolved = await this.resolveUniqueConflict(cmd, parsed, idempotencyKey, payloadHash, violation);
        if (resolved !== null) {
          this.metrics.countTransaction(resolved.status, parsed.kind, cmd.source);
          this.metrics.observeProcessingDuration(cmd.source, performance.now() - startedAt);
          return resolved;
        }
      }
      throw error;
    }
  }

  private async processInTransaction(
    tem: EntityManager,
    cmd: SubmitWagerTransactionCommand,
    parsed: ParsedSubmitPayload,
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<SubmitWagerTransactionResult> {
    const now = new Date();

    // 1. Inbox: linha existente significa efeito já commitado anteriormente.
    if (cmd.inbox !== undefined) {
      const existingInbox = await tem.findOne(InboxMessageSchema, {
        consumerName: cmd.inbox.consumerName,
        messageId: cmd.inbox.messageId,
      });
      if (existingInbox !== null) {
        this.metrics.countDuplicate('inbox');
        this.logger.info('inbox_duplicate_ignored', {
          messageId: cmd.inbox.messageId,
          providerId: parsed.providerId,
        });
        const existing = await this.findExistingTransaction(tem, parsed, idempotencyKey);
        if (existing === null) {
          throw new Error(
            `Inbox message ${cmd.inbox.messageId} is recorded but its transaction is missing`,
          );
        }
        return this.decideReplay(existing, payloadHash, idempotencyKey);
      }
      const inbox = InboxMessage.receive({
        messageId: cmd.inbox.messageId,
        consumerName: cmd.inbox.consumerName,
        payloadHash: hashRawBody(JSON.stringify(cmd.payload)),
        receivedAt: now,
      });
      inbox.markProcessed(now);
      await tem.insert(InboxMessageSchema, toInboxMessageRow(inbox));
    }

    // 2. Replay rápido: mesma key já registrada.
    const existing = await this.findExistingTransaction(tem, parsed, idempotencyKey);
    if (existing !== null) {
      return this.decideReplay(existing, payloadHash, idempotencyKey);
    }

    // 3. Grava a transação em PENDING antes de tocar no saldo: a unique
    // constraint decide corridas com a mesma key sem depender de lock de memória.
    const transaction = WagerTransaction.create({
      id: Bun.randomUUIDv7(),
      providerId: parsed.providerId,
      externalTransactionId: parsed.externalTransactionId,
      idempotencyKey,
      payloadHash,
      walletId: parsed.walletId,
      playerId: parsed.playerId,
      roundId: parsed.roundId,
      gameId: parsed.gameId,
      kind: parsed.kind,
      money: parsed.money,
      referenceExternalTransactionId: parsed.referenceExternalTransactionId,
      createdAt: now,
    });
    await tem.insert(WagerTransactionSchema, toWagerTransactionRow(transaction));

    // 4. Aplicação (lock da wallet, regras, saldo, ledger, outbox) na mesma transação SQL.
    const processor = new TransactionProcessor(tem, this.metrics, this.logger, this.config);
    const outcome = await processor.process(transaction, {
      now,
      correlationId: cmd.correlationId,
      source: cmd.source,
    });

    return {
      transactionId: outcome.transactionId,
      status: outcome.status,
      balance: outcome.balance,
      idempotentReplay: false,
      ...(outcome.failureCode !== undefined ? { failureCode: outcome.failureCode } : {}),
    };
  }

  /**
   * Corrida detectada pela unique constraint (a outra transação fez commit).
   * Uma nova transação de leitura decide replay (hash igual) ou conflito
   * (hash diferente). Retorna null quando a constraint não é de idempotência.
   */
  private async resolveUniqueConflict(
    cmd: SubmitWagerTransactionCommand,
    parsed: ParsedSubmitPayload,
    idempotencyKey: string,
    payloadHash: string,
    violation: { constraint: string; message: string },
  ): Promise<SubmitWagerTransactionResult | null> {
    const isTransactionConstraint = violation.constraint.startsWith('wager_transactions');
    const isInboxConstraint = violation.constraint.startsWith('inbox');
    if (!isTransactionConstraint && !isInboxConstraint) {
      return null;
    }
    if (isInboxConstraint) {
      this.metrics.countDuplicate('inbox');
    }
    const resolved = await this.em.transactional(async (tem) => {
      const existing = await this.findExistingTransaction(tem, parsed, idempotencyKey);
      if (existing === null) {
        return null;
      }
      return this.decideReplay(existing, payloadHash, idempotencyKey);
    });
    if (resolved === null && cmd.inbox !== undefined && isInboxConstraint) {
      throw new Error(`Inbox message ${cmd.inbox.messageId} raced but its transaction is missing`);
    }
    return resolved;
  }

  private async findExistingTransaction(
    tem: EntityManager,
    parsed: ParsedSubmitPayload,
    idempotencyKey: string,
  ): Promise<WagerTransactionRow | null> {
    const byKey = (await tem.findOne(WagerTransactionSchema, {
      providerId: parsed.providerId,
      idempotencyKey,
    })) as WagerTransactionRow | null;
    if (byKey !== null) {
      return byKey;
    }
    // Mesmo external id com outra key: a operação de negócio é a mesma.
    return (await tem.findOne(WagerTransactionSchema, {
      providerId: parsed.providerId,
      externalTransactionId: parsed.externalTransactionId,
    })) as WagerTransactionRow | null;
  }

  private decideReplay(
    row: WagerTransactionRow,
    payloadHash: string,
    idempotencyKey: string,
  ): SubmitWagerTransactionResult {
    // Mesma key com payload diferente é conflito, não replay.
    if (row.payloadHash !== payloadHash) {
      this.metrics.countIdempotencyConflict();
      this.logger.warn('idempotency_conflict', {
        transactionId: row.id,
        providerId: row.providerId,
      });
      throw new IdempotencyConflictError(idempotencyKey);
    }
    this.metrics.countDuplicate('idempotency');
    return {
      transactionId: row.id,
      status: row.status,
      balance:
        row.balanceAfter !== null
          ? { amount: row.balanceAfter, currency: row.currency }
          : undefined,
      idempotentReplay: true,
      ...(row.failureCode !== null ? { failureCode: row.failureCode } : {}),
    };
  }

  private assertKey(key: string): string {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new PayloadValidationError(['Idempotency-Key is required']);
    }
    return key.trim();
  }
}