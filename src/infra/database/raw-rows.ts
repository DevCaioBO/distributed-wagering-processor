import type {
  OutboxMessageRow,
  WalletLedgerEntryRow,
  WalletRow,
  WagerTransactionRow,
} from './rows.js';

/**
 * O `em.execute` do MikroORM devolve as colunas cruas do Postgres: snake_case
 * (sem passar pelo EntitySchema) e timestamps como string (os type parsers do
 * driver estão desligados). Estes normalizadores convertem as linhas das
 * queries crudas ao shape camelCase com `Date` esperado pelos mappers.
 */

type Raw = Record<string, unknown>;

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function asNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : asDate(value);
}

export function fromRawWallet(row: Raw): WalletRow {
  return {
    id: String(row.id),
    playerId: String(row.player_id),
    currency: String(row.currency),
    balance: String(row.balance),
    version: Number(row.version),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export function fromRawWagerTransaction(row: Raw): WagerTransactionRow {
  return {
    id: String(row.id),
    providerId: String(row.providerId),
    externalTransactionId: String(row.externalTransactionId),
    idempotencyKey: String(row.idempotencyKey),
    payloadHash: String(row.payloadHash),
    walletId: String(row.walletId),
    playerId: String(row.playerId),
    roundId: String(row.roundId),
    gameId: String(row.gameId),
    kind: row.kind as WagerTransactionRow['kind'],
    amount: String(row.amount),
    currency: String(row.currency),
    referenceExternalTransactionId: (row.referenceExternalTransactionId as string | null) ?? null,
    referenceTransactionId: (row.referenceTransactionId as string | null) ?? null,
    status: row.status as WagerTransactionRow['status'],
    failureCode: (row.failureCode as WagerTransactionRow['failureCode']) ?? null,
    createdAt: asDate(row.createdAt),
    processedAt: asNullableDate(row.processedAt),
    balanceAfter: (row.balanceAfter as string | null) ?? null,
    referenceAttempts: Number(row.referenceAttempts ?? 0),
    nextAttemptAt: asNullableDate(row.nextAttemptAt),
  };
}

export function fromRawOutboxMessage(row: Raw): OutboxMessageRow {
  return {
    id: String(row.id),
    aggregateId: String(row.aggregateId),
    eventType: String(row.eventType),
    payload: row.payload as Record<string, unknown>,
    occurredAt: asDate(row.occurredAt),
    attempts: Number(row.attempts),
    nextAttemptAt: asNullableDate(row.nextAttemptAt),
    publishedAt: asNullableDate(row.publishedAt),
  };
}

export function fromRawWalletLedgerEntry(row: Raw): WalletLedgerEntryRow {
  return {
    id: String(row.id),
    walletId: String(row.walletId),
    transactionId: String(row.transactionId),
    direction: row.direction as WalletLedgerEntryRow['direction'],
    amount: String(row.amount),
    currency: String(row.currency),
    balanceBefore: String(row.balanceBefore),
    balanceAfter: String(row.balanceAfter),
    createdAt: asDate(row.createdAt),
  };
}
