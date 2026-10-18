import { createHash } from 'node:crypto';
import type { MoneyProps } from '../domain/money.js';
import type { ParsedSubmitPayload } from './submit-payload.js';

/**
 * JSON canônico: chaves ordenadas recursivamente, sem espaços. Chave ausente
 * (undefined) é omitida. Usado como entrada do hash de payload.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);
  return `{${entries.join(',')}}`;
}

export interface PayloadHashSubset {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

/**
 * Hash do payload de negócio: SHA-256 (hex) sobre o JSON canônico do
 * subconjunto de campos de negócio, com o dinheiro normalizado para 2 casas.
 * O header Idempotency-Key e metadados de transporte (messageId, occurredAt do
 * envelope) não entram no hash — a mesma operação com representação diferente
 * ("25" vs "25.00") produz o mesmo hash e conta como replay.
 */
export function payloadHashOf(payload: ParsedSubmitPayload): string {
  const subset: PayloadHashSubset = {
    providerId: payload.providerId,
    externalTransactionId: payload.externalTransactionId,
    playerId: payload.playerId,
    walletId: payload.walletId,
    roundId: payload.roundId,
    gameId: payload.gameId,
    kind: payload.kind,
    money: payload.money.toJSON(),
    ...(payload.referenceExternalTransactionId !== undefined
      ? { referenceExternalTransactionId: payload.referenceExternalTransactionId }
      : {}),
  };
  return createHash('sha256').update(canonicalJson(subset), 'utf8').digest('hex');
}

/** Hash usado na inbox: SHA-256 sobre o corpo bruto da mensagem, para auditoria. */
export function hashRawBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}
