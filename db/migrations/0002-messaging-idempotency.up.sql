-- 0002: idempotência observável, inbox/outbox e reprocessamento de referências.

-- Saldo observado no momento da aplicação: permite devolver o resultado
-- original em replay (regra 7), inclusive para LOSS e REJECTED, que não têm
-- lançamento no ledger.
ALTER TABLE wager_transactions
  ADD COLUMN balance_after numeric(19, 2),
  ADD COLUMN reference_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz;

ALTER TABLE wager_transactions
  ADD CONSTRAINT wager_transactions_balance_after_non_negative
  CHECK (balance_after IS NULL OR balance_after >= 0);

-- Regra 4: uma referência não pode ser revertida duas vezes pelo mesmo tipo.
-- Backstop de schema para a checagem feita sob lock no processamento.
CREATE UNIQUE INDEX wager_transactions_one_reversal_per_reference
  ON wager_transactions (reference_transaction_id, kind)
  WHERE reference_transaction_id IS NOT NULL AND status = 'PROCESSED';

-- Referência resolvida por (providerId, referenceExternalTransactionId).
CREATE INDEX wager_transactions_provider_reference_idx
  ON wager_transactions (provider_id, reference_external_transaction_id)
  WHERE reference_external_transaction_id IS NOT NULL;

-- Varredura do worker de referências fora de ordem (PENDING_REFERENCE vencidas).
CREATE INDEX wager_transactions_pending_reference_idx
  ON wager_transactions (next_attempt_at)
  WHERE status = 'PENDING_REFERENCE';

-- Inbox: dedup persistente do consumidor por (consumer_name, message_id).
-- A linha só existe se o efeito financeiro foi commitado junto (mesma transação).
CREATE TABLE inbox_messages (
  message_id text NOT NULL,
  consumer_name text NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  PRIMARY KEY (consumer_name, message_id)
);

-- Outbox: evento gravado na mesma transação da mudança financeira e publicado
-- depois do commit por um worker. published_at NULL = pendente.
CREATE TABLE outbox_messages (
  id uuid PRIMARY KEY,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  published_at timestamptz,
  CONSTRAINT outbox_messages_attempts_non_negative CHECK (attempts >= 0)
);

CREATE INDEX outbox_messages_pending_idx
  ON outbox_messages (next_attempt_at, occurred_at)
  WHERE published_at IS NULL;

-- Payload do evento é imutável: worker só pode mudar tentativas e publicação.
CREATE FUNCTION forbid_outbox_payload_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.aggregate_id <> OLD.aggregate_id
     OR NEW.event_type <> OLD.event_type
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.occurred_at <> OLD.occurred_at THEN
    RAISE EXCEPTION 'outbox payload é imutável: % não é permitido', TG_OP
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_messages_payload_immutable
  BEFORE UPDATE ON outbox_messages
  FOR EACH ROW EXECUTE FUNCTION forbid_outbox_payload_mutation();
