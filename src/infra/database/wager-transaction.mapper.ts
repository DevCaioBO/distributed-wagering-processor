import type { Money } from '../../domain/money.js';
import { WagerTransaction } from '../../domain/wager-transaction.js';
import type { WagerTransactionRow } from './rows.js';

export interface WagerTransactionRowExtras {
  /** Saldo observado no momento da aplicação (replay). */
  balanceAfter?: Money;
}

export function toWagerTransactionRow(
  transaction: WagerTransaction,
  extras: WagerTransactionRowExtras = {},
): WagerTransactionRow {
  const { amount, currency } = transaction.money.toJSON();
  return {
    id: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    idempotencyKey: transaction.idempotencyKey,
    payloadHash: transaction.payloadHash,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    amount,
    currency,
    referenceExternalTransactionId: transaction.referenceExternalTransactionId ?? null,
    referenceTransactionId: transaction.referenceTransactionId ?? null,
    status: transaction.status,
    failureCode: transaction.failureCode ?? null,
    createdAt: transaction.createdAt,
    processedAt: transaction.processedAt ?? null,
    balanceAfter: extras.balanceAfter?.toJSON().amount ?? null,
    referenceAttempts: 0,
    nextAttemptAt: null,
  };
}

export function toWagerTransaction(row: WagerTransactionRow): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: row.id,
    providerId: row.providerId,
    externalTransactionId: row.externalTransactionId,
    idempotencyKey: row.idempotencyKey,
    payloadHash: row.payloadHash,
    walletId: row.walletId,
    playerId: row.playerId,
    roundId: row.roundId,
    gameId: row.gameId,
    kind: row.kind,
    money: { amount: row.amount, currency: row.currency },
    referenceExternalTransactionId: row.referenceExternalTransactionId ?? undefined,
    createdAt: row.createdAt,
    status: row.status,
    referenceTransactionId: row.referenceTransactionId ?? undefined,
    failureCode: row.failureCode ?? undefined,
    processedAt: row.processedAt ?? undefined,
  });
}
