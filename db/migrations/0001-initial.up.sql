BEGIN;

CREATE TABLE wallets (
  id uuid PRIMARY KEY,
  player_id text NOT NULL,
  currency text NOT NULL,
  balance numeric(19, 2) NOT NULL,
  version integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT wallets_player_currency_key UNIQUE (player_id, currency),
  CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0),
  CONSTRAINT wallets_version_positive CHECK (version >= 1),
  CONSTRAINT wallets_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TABLE wager_transactions (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  external_transaction_id text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  wallet_id uuid NOT NULL,
  player_id text NOT NULL,
  round_id text NOT NULL,
  game_id text NOT NULL,
  kind text NOT NULL,
  amount numeric(19, 2) NOT NULL,
  currency text NOT NULL,
  reference_external_transaction_id text,
  reference_transaction_id uuid REFERENCES wager_transactions (id),
  status text NOT NULL,
  failure_code text,
  created_at timestamptz NOT NULL,
  processed_at timestamptz,
  CONSTRAINT wager_transactions_provider_external_key UNIQUE (provider_id, external_transaction_id),
  CONSTRAINT wager_transactions_provider_idempotency_key UNIQUE (provider_id, idempotency_key),
  CONSTRAINT wager_transactions_id_wallet_key UNIQUE (id, wallet_id),
  CONSTRAINT wager_transactions_kind_valid CHECK (
    kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')
  ),
  CONSTRAINT wager_transactions_status_valid CHECK (
    status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')
  ),
  CONSTRAINT wager_transactions_amount_valid CHECK (
    amount >= 0 AND (kind = 'LOSS' OR amount > 0)
  ),
  CONSTRAINT wager_transactions_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT wager_transactions_reference_by_kind CHECK (
    (kind IN ('REFUND', 'ROLLBACK') AND reference_external_transaction_id IS NOT NULL)
    OR (kind IN ('BET', 'OPENING') AND reference_external_transaction_id IS NULL)
    OR kind IN ('WIN', 'LOSS')
  ),
  CONSTRAINT wager_transactions_failure_code_by_status CHECK (
    (status IN ('REJECTED', 'FAILED')) = (failure_code IS NOT NULL)
  ),
  CONSTRAINT wager_transactions_failure_code_valid CHECK (
    failure_code IS NULL OR failure_code IN (
      'INSUFFICIENT_FUNDS',
      'REVERSAL_WOULD_OVERDRAW',
      'REFERENCE_NOT_FOUND',
      'REFERENCE_MISMATCH',
      'INVALID_REFERENCE_KIND',
      'REFERENCE_NOT_PROCESSED',
      'ALREADY_REVERSED',
      'AMOUNT_MISMATCH',
      'CURRENCY_MISMATCH',
      'WALLET_NOT_FOUND',
      'WALLET_PLAYER_MISMATCH',
      'PROCESSING_FAILED'
    )
  ),
  CONSTRAINT wager_transactions_processed_at_by_status CHECK (
    (status = 'PROCESSED') = (processed_at IS NOT NULL)
  ),
  CONSTRAINT wager_transactions_system_provider_only_opening CHECK (
    (kind = 'OPENING') = (provider_id = 'system')
  )
);

CREATE UNIQUE INDEX wager_transactions_one_opening_per_wallet
  ON wager_transactions (wallet_id)
  WHERE kind = 'OPENING';

CREATE TABLE wallet_ledger_entries (
  id uuid PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES wallets (id),
  transaction_id uuid NOT NULL,
  direction text NOT NULL,
  amount numeric(19, 2) NOT NULL,
  currency text NOT NULL,
  balance_before numeric(19, 2) NOT NULL,
  balance_after numeric(19, 2) NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT wallet_ledger_entries_wallet_transaction_key UNIQUE (wallet_id, transaction_id),
  CONSTRAINT wallet_ledger_entries_transaction_wallet_fkey
    FOREIGN KEY (transaction_id, wallet_id) REFERENCES wager_transactions (id, wallet_id),
  CONSTRAINT wallet_ledger_entries_direction_valid CHECK (direction IN ('DEBIT', 'CREDIT')),
  CONSTRAINT wallet_ledger_entries_amount_positive CHECK (amount > 0),
  CONSTRAINT wallet_ledger_entries_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT wallet_ledger_entries_balances_non_negative CHECK (
    balance_before >= 0 AND balance_after >= 0
  ),
  CONSTRAINT wallet_ledger_entries_arithmetic CHECK (
    (direction = 'DEBIT' AND balance_before - amount = balance_after)
    OR (direction = 'CREDIT' AND balance_before + amount = balance_after)
  )
);

CREATE INDEX wallet_ledger_entries_wallet_created_idx
  ON wallet_ledger_entries (wallet_id, created_at, id);

CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger_entries é imutável: % não é permitido', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER wallet_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON wallet_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

COMMIT;