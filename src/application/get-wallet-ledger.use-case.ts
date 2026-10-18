import type { EntityManager } from '@mikro-orm/postgresql';
import type { MoneyProps } from '../domain/money.js';
import { LedgerDirection } from '../domain/wallet-ledger-entry.js';
import type { WalletLedgerEntryRow, WalletRow } from '../infra/database/rows.js';
import { WalletSchema } from '../infra/database/schemas.js';
import { PayloadValidationError, WalletNotFoundError } from './errors.js';

export interface LedgerEntryResponse {
  id: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface GetWalletLedgerResult {
  entries: LedgerEntryResponse[];
  nextCursor: string | null;
}

export const LEDGER_DEFAULT_LIMIT = 50;
export const LEDGER_MAX_LIMIT = 100;

interface Cursor {
  createdAt: string;
  id: string;
}

/**
 * Página do ledger da wallet por cursor opaco e estável: (created_at, id) em
 * ordem decrescente, casando com o índice (wallet_id, created_at, id).
 * O cursor é base64url de "ISO|uuid" — opaco para o cliente, determinístico
 * para o servidor, e estável mesmo com timestamps repetidos.
 */
export class GetWalletLedgerUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(
    walletId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<GetWalletLedgerResult> {
    const wallet = (await this.em.findOne(WalletSchema, { id: walletId })) as WalletRow | null;
    if (wallet === null) {
      throw new WalletNotFoundError(walletId);
    }

    const limit = this.parseLimit(options.limit);
    const cursor = options.cursor !== undefined ? decodeCursor(options.cursor) : undefined;

    const rows = (await this.em.execute<WalletLedgerEntryRow[]>(
      cursor === undefined
        ? `select * from wallet_ledger_entries where wallet_id = ?
             order by created_at desc, id desc limit ?`
        : `select * from wallet_ledger_entries
             where wallet_id = ? and (created_at, id) < (?::timestamptz, ?::uuid)
             order by created_at desc, id desc limit ?`,
      cursor === undefined
        ? [walletId, limit + 1]
        : [walletId, cursor.createdAt, cursor.id, limit + 1],
      'all',
    )) as WalletLedgerEntryRow[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      entries: page.map((row) => ({
        id: row.id,
        transactionId: row.transactionId,
        direction: row.direction,
        money: { amount: row.amount, currency: row.currency },
        balanceBefore: { amount: row.balanceBefore, currency: row.currency },
        balanceAfter: { amount: row.balanceAfter, currency: row.currency },
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last !== undefined ? encodeCursor(last) : null,
    };
  }

  private parseLimit(limit: number | undefined): number {
    if (limit === undefined) {
      return LEDGER_DEFAULT_LIMIT;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > LEDGER_MAX_LIMIT) {
      throw new PayloadValidationError([`limit must be an integer between 1 and ${LEDGER_MAX_LIMIT}`]);
    }
    return limit;
  }
}

export function encodeCursor(row: WalletLedgerEntryRow): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new PayloadValidationError(['cursor is invalid']);
  }
  const [createdAt = '', id = ''] = decoded.split('|');
  if (createdAt === '' || id === '' || Number.isNaN(Date.parse(createdAt))) {
    throw new PayloadValidationError(['cursor is invalid']);
  }
  return { createdAt, id };
}