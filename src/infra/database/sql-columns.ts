/**
 * Fragmentos de coluna com aliases camelCase para queries crudas via
 * `em.execute`. O `execute` devolve as colunas exatamente como o Postgres as
 * nomeia (snake_case), sem passar pelo mapeamento do EntitySchema — estes
 * fragmentos alinham o resultado às `*Row` de `rows.ts` e aos mappers.
 */
export const WAGER_TRANSACTION_COLUMNS = `
  id,
  provider_id as "providerId",
  external_transaction_id as "externalTransactionId",
  idempotency_key as "idempotencyKey",
  payload_hash as "payloadHash",
  wallet_id as "walletId",
  player_id as "playerId",
  round_id as "roundId",
  game_id as "gameId",
  kind,
  amount::text as amount,
  currency,
  reference_external_transaction_id as "referenceExternalTransactionId",
  reference_transaction_id as "referenceTransactionId",
  status,
  failure_code as "failureCode",
  created_at as "createdAt",
  processed_at as "processedAt",
  balance_after::text as "balanceAfter",
  reference_attempts as "referenceAttempts",
  next_attempt_at as "nextAttemptAt"`;

export const OUTBOX_MESSAGE_COLUMNS = `
  id,
  aggregate_id as "aggregateId",
  event_type as "eventType",
  payload,
  occurred_at as "occurredAt",
  attempts,
  next_attempt_at as "nextAttemptAt",
  published_at as "publishedAt"`;

export const WALLET_LEDGER_ENTRY_COLUMNS = `
  id,
  wallet_id as "walletId",
  transaction_id as "transactionId",
  direction,
  amount::text as amount,
  currency,
  balance_before::text as "balanceBefore",
  balance_after::text as "balanceAfter",
  created_at as "createdAt"`;
