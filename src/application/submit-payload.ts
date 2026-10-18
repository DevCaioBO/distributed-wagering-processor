import { InvalidMoneyError } from '../domain/errors.js';
import { Money } from '../domain/money.js';
import { WagerTransactionKind } from '../domain/wager-transaction.js';
import { PayloadValidationError } from './errors.js';

export interface SubmitPayloadInput {
  providerId?: unknown;
  externalTransactionId?: unknown;
  playerId?: unknown;
  walletId?: unknown;
  roundId?: unknown;
  gameId?: unknown;
  kind?: unknown;
  money?: unknown;
  referenceExternalTransactionId?: unknown;
}

/** Payload de negócio validado e normalizado — o único input aceito pelo processamento. */
export interface ParsedSubmitPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId: string | undefined;
}

const TEXT_FIELDS = [
  'providerId',
  'externalTransactionId',
  'playerId',
  'walletId',
  'roundId',
  'gameId',
] as const;

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isSubmitPayloadKind(kind: string): kind is WagerTransactionKind {
  return (
    kind === WagerTransactionKind.Bet ||
    kind === WagerTransactionKind.Win ||
    kind === WagerTransactionKind.Loss ||
    kind === WagerTransactionKind.Refund ||
    kind === WagerTransactionKind.Rollback
  );
}

/**
 * Valida o payload submetido por provedor (HTTP ou fila). OPENING é interno e
 * não pode ser submetido de fora. Lança PayloadValidationError com todos os
 * problemas encontrados, para o provedor corrigir de uma vez.
 */
export function parseSubmitPayload(input: unknown): ParsedSubmitPayload {
  const details: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new PayloadValidationError(['payload must be an object']);
  }
  const raw = input as SubmitPayloadInput;

  const text: Record<(typeof TEXT_FIELDS)[number], string> = {
    providerId: '',
    externalTransactionId: '',
    playerId: '',
    walletId: '',
    roundId: '',
    gameId: '',
  };
  for (const field of TEXT_FIELDS) {
    if (isFilled(raw[field])) {
      text[field] = raw[field].trim();
    } else {
      details.push(`${field} is required`);
    }
  }

  let kind: WagerTransactionKind | undefined;
  if (isFilled(raw.kind) && isSubmitPayloadKind(raw.kind.trim())) {
    kind = raw.kind.trim() as WagerTransactionKind;
  } else if (isFilled(raw.kind) && raw.kind.trim() === WagerTransactionKind.Opening) {
    details.push('OPENING is internal and cannot be submitted');
  } else {
    details.push(`kind must be one of BET, WIN, LOSS, REFUND, ROLLBACK`);
  }

  let money: Money | undefined;
  const rawMoney = raw.money as { amount?: unknown; currency?: unknown } | undefined;
  if (
    typeof rawMoney !== 'object' ||
    rawMoney === null ||
    typeof rawMoney.amount !== 'string' ||
    typeof rawMoney.currency !== 'string'
  ) {
    details.push('money must be an object with amount and currency strings');
  } else {
    try {
      money = Money.from({ amount: rawMoney.amount.trim(), currency: rawMoney.currency.trim() });
    } catch (error) {
      if (error instanceof InvalidMoneyError) {
        details.push(error.message);
      } else {
        throw error;
      }
    }
  }

  let referenceExternalTransactionId: string | undefined;
  if (raw.referenceExternalTransactionId !== undefined) {
    if (isFilled(raw.referenceExternalTransactionId)) {
      referenceExternalTransactionId = raw.referenceExternalTransactionId.trim();
    } else {
      details.push('referenceExternalTransactionId cannot be blank');
    }
  }

  if (details.length > 0) {
    throw new PayloadValidationError(details);
  }

  return {
    ...text,
    kind: kind!,
    money: money!,
    referenceExternalTransactionId,
  };
}
