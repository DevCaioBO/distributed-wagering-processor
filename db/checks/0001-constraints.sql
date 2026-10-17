BEGIN;

INSERT INTO wallets (id, player_id, currency, balance, version, created_at, updated_at)
VALUES
  ('00000000-0000-7000-8000-000000000001', 'player-1', 'BRL', 100.00, 1, now(), now()),
  ('00000000-0000-7000-8000-000000000009', 'player-2', 'BRL', 0.00, 1, now(), now());

INSERT INTO wager_transactions (
  id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
  player_id, round_id, game_id, kind, amount, currency, status, created_at, processed_at
) VALUES (
  '00000000-0000-7000-8000-000000000002', 'system',
  'opening:00000000-0000-7000-8000-000000000001', 'opening:00000000-0000-7000-8000-000000000001',
  'opening', '00000000-0000-7000-8000-000000000001', 'player-1', 'opening', 'opening',
  'OPENING', 100.00, 'BRL', 'PROCESSED', now(), now()
);

INSERT INTO wallet_ledger_entries (
  id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at
) VALUES (
  '00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000001',
  '00000000-0000-7000-8000-000000000002', 'CREDIT', 100.00, 'BRL', 0.00, 100.00, now()
);

INSERT INTO wager_transactions (
  id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
  player_id, round_id, game_id, kind, amount, currency, status, created_at
) VALUES (
  '00000000-0000-7000-8000-000000000004', 'provider-a', 'tx-1', 'provider-a:tx-1', 'hash-1',
  '00000000-0000-7000-8000-000000000001', 'player-1', 'round-1', 'game-1',
  'BET', 25.00, 'BRL', 'PENDING', now()
);

DO $$
BEGIN
  UPDATE wallets SET balance = -1 WHERE id = '00000000-0000-7000-8000-000000000001';
  RAISE NOTICE 'FALHA: saldo negativo foi aceito';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, saldo negativo barrado: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO wallets (id, player_id, currency, balance, version, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-000000000005', 'player-1', 'BRL', 0.00, 1, now(), now());
  RAISE NOTICE 'FALHA: segunda wallet do mesmo jogador e moeda foi aceita';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, wallet duplicada barrada: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO wager_transactions (
    id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
    player_id, round_id, game_id, kind, amount, currency, status, created_at
  ) VALUES (
    '00000000-0000-7000-8000-000000000006', 'provider-a', 'tx-1', 'provider-a:outra', 'hash-2',
    '00000000-0000-7000-8000-000000000001', 'player-1', 'round-1', 'game-1',
    'BET', 25.00, 'BRL', 'PENDING', now()
  );
  RAISE NOTICE 'FALHA: id externo repetido do mesmo provedor foi aceito';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, id externo repetido barrado: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO wager_transactions (
    id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
    player_id, round_id, game_id, kind, amount, currency, status, created_at
  ) VALUES (
    '00000000-0000-7000-8000-000000000007', 'provider-a', 'tx-2', 'provider-a:tx-1', 'hash-3',
    '00000000-0000-7000-8000-000000000001', 'player-1', 'round-1', 'game-1',
    'BET', 25.00, 'BRL', 'PENDING', now()
  );
  RAISE NOTICE 'FALHA: idempotency key repetida do mesmo provedor foi aceita';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, idempotency key repetida barrada: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO wallet_ledger_entries (
    id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at
  ) VALUES (
    '00000000-0000-7000-8000-000000000008', '00000000-0000-7000-8000-000000000001',
    '00000000-0000-7000-8000-000000000002', 'CREDIT', 100.00, 'BRL', 100.00, 200.00, now()
  );
  RAISE NOTICE 'FALHA: segundo lançamento da mesma transação foi aceito';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, lançamento duplicado da mesma transação barrado: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO wallet_ledger_entries (
    id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at
  ) VALUES (
    '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-000000000001',
    '00000000-0000-7000-8000-000000000004', 'DEBIT', 25.00, 'BRL', 100.00, 80.00, now()
  );
  RAISE NOTICE 'FALHA: aritmética errada do ledger foi aceita';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, aritmética errada barrada: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO wallet_ledger_entries (
    id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at
  ) VALUES (
    '00000000-0000-7000-8000-00000000000c', '00000000-0000-7000-8000-000000000009',
    '00000000-0000-7000-8000-000000000004', 'CREDIT', 25.00, 'BRL', 0.00, 25.00, now()
  );
  RAISE NOTICE 'FALHA: lançamento em wallet diferente da transação foi aceito';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, lançamento em outra wallet barrado: %', SQLERRM;
END $$;

DO $$
BEGIN
  UPDATE wallet_ledger_entries SET amount = 1.00 WHERE id = '00000000-0000-7000-8000-000000000003';
  RAISE NOTICE 'FALHA: UPDATE no ledger foi aceito';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, UPDATE no ledger barrado: %', SQLERRM;
END $$;

DO $$
BEGIN
  DELETE FROM wallet_ledger_entries WHERE id = '00000000-0000-7000-8000-000000000003';
  RAISE NOTICE 'FALHA: DELETE no ledger foi aceito';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, DELETE no ledger barrado: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO wager_transactions (
    id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
    player_id, round_id, game_id, kind, amount, currency, status, created_at
  ) VALUES (
    '00000000-0000-7000-8000-00000000000d', 'system', 'tx-falso', 'system:tx-falso', 'hash-4',
    '00000000-0000-7000-8000-000000000001', 'player-1', 'round-1', 'game-1',
    'BET', 25.00, 'BRL', 'PENDING', now()
  );
  RAISE NOTICE 'FALHA: provedor reservado system usado fora da abertura';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, uso indevido do provedor system barrado: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO wager_transactions (
    id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
    player_id, round_id, game_id, kind, amount, currency, status, created_at, processed_at
  ) VALUES (
    '00000000-0000-7000-8000-00000000000e', 'system', 'opening:segunda', 'opening:segunda', 'opening',
    '00000000-0000-7000-8000-000000000001', 'player-1', 'opening', 'opening',
    'OPENING', 10.00, 'BRL', 'PROCESSED', now(), now()
  );
  RAISE NOTICE 'FALHA: segunda abertura da mesma wallet foi aceita';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, segunda abertura da mesma wallet barrada: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO wager_transactions (
    id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
    player_id, round_id, game_id, kind, amount, currency, status, created_at
  ) VALUES (
    '00000000-0000-7000-8000-00000000000f', 'provider-a', 'tx-3', 'provider-a:tx-3', 'hash-5',
    '00000000-0000-7000-8000-000000000001', 'player-1', 'round-1', 'game-1',
    'REFUND', 25.00, 'BRL', 'PENDING', now()
  );
  RAISE NOTICE 'FALHA: REFUND sem referência foi aceito';
EXCEPTION WHEN integrity_constraint_violation THEN
  RAISE NOTICE 'ok, REFUND sem referência barrado: %', SQLERRM;
END $$;

ROLLBACK;