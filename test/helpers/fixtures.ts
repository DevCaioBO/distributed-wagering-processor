import { randomUUID } from 'node:crypto';
import type { TestEm } from './orm.js';


export async function truncateBusinessTables(em: TestEm): Promise<void> {
  await em.execute(
    `truncate table inbox_messages, outbox_messages, wallet_ledger_entries,
       wager_transactions, wallets restart identity cascade`,
    [],
    'run',
  );
}

export function uniqueSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}


export async function seedWallet(
  em: TestEm,
  props: { id?: string; playerId: string; currency: string; balance: string },
): Promise<string> {
  const id = props.id ?? randomUUID();
  await em.execute(
    `insert into wallets (id, player_id, currency, balance, version, created_at, updated_at)
     values (?::uuid, ?, ?, ?::numeric, 1, now(), now())`,
    [id, props.playerId, props.currency, props.balance],
    'run',
  );
  return id;
}