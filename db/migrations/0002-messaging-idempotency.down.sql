DROP TRIGGER IF EXISTS outbox_messages_payload_immutable ON outbox_messages;
DROP FUNCTION IF EXISTS forbid_outbox_payload_mutation();
DROP INDEX IF EXISTS outbox_messages_pending_idx;
DROP TABLE IF EXISTS outbox_messages;
DROP TABLE IF EXISTS inbox_messages;
DROP INDEX IF EXISTS wager_transactions_pending_reference_idx;
DROP INDEX IF EXISTS wager_transactions_provider_reference_idx;
DROP INDEX IF EXISTS wager_transactions_one_reversal_per_reference;
ALTER TABLE wager_transactions DROP CONSTRAINT IF EXISTS wager_transactions_balance_after_non_negative;
ALTER TABLE wager_transactions
  DROP COLUMN IF EXISTS next_attempt_at,
  DROP COLUMN IF EXISTS reference_attempts,
  DROP COLUMN IF EXISTS balance_after;
