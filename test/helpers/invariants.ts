import { expect } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';

interface BalanceRow {
  stored: string;
  calculated: string;
}

/**
 * Invariante central do desafio: o saldo materializado da wallet é sempre
 * igual ao saldo reconstruído pela soma do ledger (numeric(19,2) dos dois
 * lados). Verifica também ausência de saldo negativo e de lançamentos
 * duplicados para a mesma transação.
 */
export async function expectWalletConsistent(
  em: EntityManager,
  walletId: string,
): Promise<void> {
  const rows = await em.execute<BalanceRow[]>(
    `select w.balance::numeric(19,2)::text as stored,
            coalesce(sum(case when l.direction = 'CREDIT' then l.amount else -l.amount end), 0)::numeric(19,2)::text as calculated
       from wallets w
       left join wallet_ledger_entries l on l.wallet_id = w.id
      where w.id = ?::uuid
      group by w.id, w.balance`,
    [walletId],
    'all',
  );
  expect(rows.length).toBe(1);
  expect(rows[0]?.stored).toBe(rows[0]?.calculated);

  const negative = await em.execute<{ count: string }[]>(
    `select count(*)::text as count from wallets where id = ?::uuid and balance < 0`,
    [walletId],
    'all',
  );
  expect(Number(negative[0]?.count ?? '1')).toBe(0);

  const duplicated = await em.execute<{ count: string }[]>(
    `select count(*)::text as count from (
       select transaction_id from wallet_ledger_entries
        where wallet_id = ?::uuid
        group by transaction_id having count(*) > 1
     ) t`,
    [walletId],
    'all',
  );
  expect(Number(duplicated[0]?.count ?? '1')).toBe(0);
}

/** Conta lançamentos por direção para uma wallet. */
export async function ledgerCount(
  em: EntityManager,
  walletId: string,
  direction?: 'DEBIT' | 'CREDIT',
): Promise<number> {
  const rows = await em.execute<{ count: string }[]>(
    direction === undefined
      ? `select count(*)::text as count from wallet_ledger_entries where wallet_id = ?::uuid`
      : `select count(*)::text as count from wallet_ledger_entries where wallet_id = ?::uuid and direction = ?`,
    direction === undefined ? [walletId] : [walletId, direction],
    'all',
  );
  return Number(rows[0]?.count ?? '0');
}
