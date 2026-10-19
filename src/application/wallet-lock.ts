import { DeadlockException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { MetricsPort } from './ports/metrics.port.js';
import type { WalletRow } from '../infra/database/rows.js';
import { fromRawWallet } from '../infra/database/raw-rows.js';

/**
 * A unidade de concorrência é a wallet. Todo caminho que altera saldo passa
 * por aqui: `SELECT ... FOR UPDATE` na linha da wallet serializa as operações
 * daquela wallet entre qualquer quantidade de instâncias, sem lock global.
 * O tempo de espera é medido para a métrica de contenção.
 */
export async function lockWalletForUpdate(
  em: EntityManager,
  walletId: string,
  metrics: MetricsPort,
): Promise<WalletRow | null> {
  const startedAt = performance.now();
  try {
    // `select *` cru: snake_case e timestamps como string — `fromRawWallet`
    // converte para o shape camelCase com Date usado pelo mapper da wallet.
    const rows = await em.execute<Record<string, unknown>[]>(
      'select * from wallets where id = ? for update',
      [walletId],
      'all',
    );
    const raw = rows[0];
    if (raw === undefined) {
      return null;
    }
    return fromRawWallet(raw);
  } finally {
    metrics.observeWalletLockWait(performance.now() - startedAt);
  }
}

/** Violação de unicidade do PostgreSQL (23505), com o nome da constraint quando exposto. */
export function uniqueViolationOf(error: unknown): { constraint: string; message: string } | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const code = 'code' in error ? String(error.code) : '';
  if (code !== '23505') {
    return null;
  }
  const message = 'message' in error ? String(error.message) : '';
  return { constraint: extractConstraint(message), message };
}

/** Erros transitórios de infraestrutura: vale tentar de novo depois. */
export function isTransientError(error: unknown): boolean {
  if (error instanceof DeadlockException) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = 'code' in error ? String(error.code) : '';
  // 08xxx conexão, 53xxx recurso, 40001 serialização, 40P01 deadlock, 57014 cancelado
  if (
    code.startsWith('08') ||
    code.startsWith('53') ||
    code === '40001' ||
    code === '40P01' ||
    code === '57014'
  ) {
    return true;
  }
  const cause = extractCauseText(error);
  return (
    cause.includes('ECONNREFUSED') ||
    cause.includes('ETIMEDOUT') ||
    cause.includes('EPIPE') ||
    cause.includes('fetch failed')
  );
}

/** Extrai texto do `cause` apenas quando for string ou Error — evita `[object Object]`. */
function extractCauseText(error: object): string {
  if (!('cause' in error)) {
    return '';
  }
  const cause: unknown = error.cause;
  if (typeof cause === 'string') {
    return cause;
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  return '';
}

/** Conflito de lock (serialização/deadlock) — conta como métrica de concorrência. */
export function isLockConflict(error: unknown): boolean {
  return error instanceof DeadlockException;
}

function extractConstraint(message: string): string {
  const match = /unique constraint "([^"]+)"/.exec(message);
  if (match) {
    return match[1] ?? '';
  }
  // Fallback para mensagens em outros idiomas: procura nomes de constraints conhecidos.
  const known = [
    'wallets_player_currency_key',
    'wager_transactions_provider_external_key',
    'wager_transactions_provider_idempotency_key',
    'wallet_ledger_entries_wallet_transaction_key',
    'wager_transactions_one_opening_per_wallet',
    'wager_transactions_one_reversal_per_reference',
    'inbox_messages_pkey',
  ];
  return known.find((name) => message.includes(name)) ?? '';
}