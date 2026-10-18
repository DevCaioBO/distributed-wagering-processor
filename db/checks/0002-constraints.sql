BEGIN;

INSERT INTO wallets (id, player_id, currency, balance, version, created_at, updated_at)
VALUES ('00000000-0000-7000-8000-000000000101', 'check-player-2', 'BRL', 100.00, 1, now(), now());

INSERT INTO wager_transactions (
  id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
  player_id, round_id, game_id, kind, amount, currency, status, created_at, processed_at, balance_after
) VALUES (
  '00000000-0000-7000-8000-000000000102', 'system',
  'opening:00000000-0000-7000-8000-000000000101', 'opening:00000000-0000-7000-8000-000000000101',
  'opening', '00000000-0000-7000-8000-000000000101', 'check-player-2', 'opening', 'opening',
  'OPENING', 100.00, 'BRL', 'PROCESSED', now(), now(), 100.00
);

-- BET que já foi revertida por um REFUND PROCESSED (para testar a unicidade da reversão).
INSERT INTO wager_transactions (
  id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
  player_id, round_id, game_id, kind, amount, currency, status, created_at, processed_at, balance_after
) VALUES (
  '00000000-0000-7000-8000-000000000103', 'provider-a', 'bet-1', 'provider-a:bet-1', 'hash-1',
  '00000000-0000-7000-8000-000000000101', 'check-player-2', 'round-1', 'game-1',
  'BET', 25.00, 'BRL', 'PROCESSED', now(), now(), 75.00
);

INSERT INTO wager_transactions (
  id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
  player_id, round_id, game_id, kind, amount, currency, status, created_at, processed_at,
  reference_external_transaction_id, reference_transaction_id, balance_after
) VALUES (
  '00000000-0000-7000-8000-000000000104', 'provider-a', 'refund-1', 'provider-a:refund-1', 'hash-2',
  '00000000-0000-7000-8000-000000000101', 'check-player-2', 'round-1', 'game-1',
  'REFUND', 25.00, 'BRL', 'PROCESSED', now(), now(),
  'bet-1', '00000000-0000-7000-8000-000000000103', 100.00
);

DO $$
BEGIN
  UPDATE wager_transactions SET balance_after = -1.00
    WHERE id = '00000000-0000-7000-8000-000000000103';
  RAISE NOTICE 'FALHA: balance_after negativo foi aceito';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, balance_after negativo barrado: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO wager_transactions (
    id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
    player_id, round_id, game_id, kind, amount, currency, status, created_at, processed_at,
    reference_external_transaction_id, reference_transaction_id, balance_after
  ) VALUES (
    '00000000-0000-7000-8000-000000000105', 'provider-a', 'refund-2', 'provider-a:refund-2', 'hash-3',
    '00000000-0000-7000-8000-000000000101', 'check-player-2', 'round-1', 'game-1',
    'REFUND', 25.00, 'BRL', 'PROCESSED', now(), now(),
    'bet-1', '00000000-0000-7000-8000-000000000103', 125.00
  );
  RAISE NOTICE 'FALHA: segunda reversão do mesmo tipo sobre a mesma referência foi aceita';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, reversão duplicada barrada: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO inbox_messages (message_id, consumer_name, payload_hash, received_at)
  VALUES ('msg-1', 'consumer-1', 'hash-a', now());
END $$;

DO $$
BEGIN
  INSERT INTO inbox_messages (message_id, consumer_name, payload_hash, received_at)
  VALUES ('msg-1', 'consumer-1', 'hash-a', now());
  RAISE NOTICE 'FALHA: mensagem duplicada na inbox do mesmo consumidor foi aceita';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, mensagem duplicada na inbox barrada: %', SQLERRM;
END $$;

DO $$
BEGIN
  -- Outro consumidor pode registrar a mesma messageId: a unicidade é por consumidor.
  INSERT INTO inbox_messages (message_id, consumer_name, payload_hash, received_at)
  VALUES ('msg-1', 'consumer-2', 'hash-a', now());
  RAISE NOTICE 'ok, mesma messageId de outro consumidor aceita (unicidade é por consumidor)';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'FALHA: outro consumidor não conseguiu registrar msg-1';
END $$;

DO $$
BEGIN
  INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts)
  VALUES ('00000000-0000-7000-8000-000000000106', 'tx-1', 'WagerTransactionProcessed', '{}'::jsonb, now(), 0);
END $$;

DO $$
BEGIN
  UPDATE outbox_messages SET attempts = -1
    WHERE id = '00000000-0000-7000-8000-000000000106';
  RAISE NOTICE 'FALHA: attempts negativo foi aceito';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, attempts negativo barrado: %', SQLERRM;
END $$;

DO $$
BEGIN
  UPDATE outbox_messages SET payload = '{"outro": true}'::jsonb
    WHERE id = '00000000-0000-7000-8000-000000000106';
  RAISE NOTICE 'FALHA: payload da outbox foi alterado';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, alteração de payload barrada: %', SQLERRM;
END $$;

ROLLBACK;
