import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { closeTestOrm, getTestEm, type TestEm } from '../helpers/orm.js';
import { seedWallet, truncateBusinessTables } from '../helpers/fixtures.js';

interface ConstraintRow {
  constraint_name: string;
}

interface IndexRow {
  indexname: string;
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

let em: TestEm;

beforeAll(async () => {
  em = await getTestEm();
});

afterAll(async () => {
  await closeTestOrm();
});

beforeEach(async () => {
  await truncateBusinessTables(em);
});

async function tableExists(name: string): Promise<boolean> {
  const rows = await em.execute<{ exists: boolean }[]>(
    `select exists (
       select from information_schema.tables where table_name = ?
     ) as exists`,
    [name],
    'all',
  );
  return rows[0]?.exists === true;
}

async function constraintNames(table: string): Promise<string[]> {
  const rows = await em.execute<ConstraintRow[]>(
    `select conname as constraint_name
       from pg_constraint
      where conrelid = ?::regclass and contype = 'u'`,
    [table],
    'all',
  );
  return rows.map((row: ConstraintRow) => row.constraint_name);
}

describe('garantias do schema (migrations)', () => {
  it('cria as tabelas de negócio', async () => {
    for (const table of [
      'wallets',
      'wager_transactions',
      'wallet_ledger_entries',
      'inbox_messages',
      'outbox_messages',
    ]) {
      expect(await tableExists(table)).toBe(true);
    }
  });

  it('impõe unicidade de (provider_id, idempotency_key) em wager_transactions', async () => {
    const names = await constraintNames('wager_transactions');
    expect(names.some((n) => n.includes('provider') && n.includes('idempotency'))).toBe(true);
  });

  it('impõe unicidade de (provider_id, external_transaction_id) em wager_transactions', async () => {
    const names = await constraintNames('wager_transactions');
    expect(names.some((n) => n.includes('provider') && n.includes('external'))).toBe(true);
  });

  it('impõe unicidade de (player_id, currency) em wallets', async () => {
    const names = await constraintNames('wallets');
    expect(names.some((n) => n.includes('player') && n.includes('currency'))).toBe(true);
  });

  it('impõe unicidade parcial de uma reversão por referência (backstop)', async () => {
    const rows = await em.execute<IndexRow[]>(
      `select indexname from pg_indexes
        where tablename = 'wager_transactions'
          and indexdef ilike '%reference_transaction_id%'
          and indexdef ilike '%kind%'
          and indexdef ilike '%where%'`,
      [],
      'all',
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('tipa valores monetários como numeric(19,2), nunca float', async () => {
    const rows = await em.execute<ColumnRow[]>(
      `select table_name, column_name, data_type, numeric_precision, numeric_scale
         from information_schema.columns
        where column_name in ('balance', 'amount', 'balance_before', 'balance_after')
          and table_schema = 'public'`,
      [],
      'all',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.data_type).toBe('numeric');
      expect(row.numeric_precision).toBe(19);
      expect(row.numeric_scale).toBe(2);
    }
  });

  it('torna o ledger imutável por trigger (UPDATE/DELETE bloqueados)', async () => {
    const walletId = await seedWallet(em, {
      playerId: 'ledger-immutable',
      currency: 'BRL',
      balance: '10.00',
    });
    const transactionId = crypto.randomUUID();
    await em.execute(
      `insert into wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, amount, currency, status,
          created_at, processed_at)
       values (?::uuid, 'system', ?, ?, 'hash', ?::uuid, 'ledger-immutable', 'opening', 'opening',
               'OPENING', 10.00, 'BRL', 'PROCESSED', now(), now())`,
      [transactionId, `opening:${walletId}`, `opening:${walletId}`, walletId],
      'run',
    );
    await em.execute(
      `insert into wallet_ledger_entries
         (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at)
       values (?::uuid, ?::uuid, ?::uuid, 'CREDIT', 10.00, 'BRL', 0.00, 10.00, now())`,
      [crypto.randomUUID(), walletId, transactionId],
      'run',
    );

    await expect(
      em.execute(
        `update wallet_ledger_entries set amount = 999.99 where wallet_id = ?::uuid`,
        [walletId],
        'run',
      ),
    ).rejects.toThrow();
    await expect(
      em.execute(`delete from wallet_ledger_entries where wallet_id = ?::uuid`, [walletId], 'run'),
    ).rejects.toThrow();
  });

  it('impede saldo negativo no CHECK da wallet', async () => {
    await expect(
      em.execute(
        `insert into wallets (id, player_id, currency, balance, version, created_at, updated_at)
         values (?::uuid, 'neg', 'BRL', -0.01, 1, now(), now())`,
        [crypto.randomUUID()],
        'run',
      ),
    ).rejects.toThrow(/wallets_balance_non_negative/);
  });
});