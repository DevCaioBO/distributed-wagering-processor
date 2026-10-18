import { describe, expect, it } from 'bun:test';
import { PayloadValidationError } from '../../src/application/errors.js';
import { parseSubmitPayload } from '../../src/application/submit-payload.js';
import { WagerTransactionKind } from '../../src/domain/wager-transaction.js';

function rawPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    providerId: 'prov-1',
    externalTransactionId: 'tx-1',
    playerId: 'player-1',
    walletId: '0190f0d8-0000-7000-8000-000000000001',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: { amount: '10.00', currency: 'BRL' },
    ...overrides,
  };
}

describe('parseSubmitPayload', () => {
  it('aceita um payload BET completo', () => {
    const parsed = parseSubmitPayload(rawPayload());

    expect(parsed.providerId).toBe('prov-1');
    expect(parsed.kind).toBe(WagerTransactionKind.Bet);
    expect(parsed.money.toJSON()).toEqual({ amount: '10.00', currency: 'BRL' });
    expect(parsed.referenceExternalTransactionId).toBeUndefined();
  });

  it('aceita WIN com referência', () => {
    const parsed = parseSubmitPayload(
      rawPayload({ kind: 'WIN', referenceExternalTransactionId: 'tx-0' }),
    );

    expect(parsed.kind).toBe(WagerTransactionKind.Win);
    expect(parsed.referenceExternalTransactionId).toBe('tx-0');
  });

  it('aceita todos os kinds válidos', () => {
    for (const kind of ['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']) {
      expect(() => parseSubmitPayload(rawPayload({ kind }))).not.toThrow();
    }
  });

  it('rejeita payload não-objeto', () => {
    expect(() => parseSubmitPayload('oi')).toThrow(PayloadValidationError);
    expect(() => parseSubmitPayload(null)).toThrow(PayloadValidationError);
    expect(() => parseSubmitPayload([])).toThrow(PayloadValidationError);
  });

  it('rejeita campos obrigatórios ausentes', () => {
    for (const field of ['providerId', 'externalTransactionId', 'playerId', 'walletId', 'roundId', 'gameId']) {
      expect(() => parseSubmitPayload(rawPayload({ [field]: undefined }))).toThrow(
        PayloadValidationError,
      );
    }
  });

  it('rejeita strings vazias nos campos de identificação', () => {
    expect(() => parseSubmitPayload(rawPayload({ playerId: '   ' }))).toThrow(
      PayloadValidationError,
    );
  });

  it('rejeita OPENING (interno, não submetível)', () => {
    expect(() => parseSubmitPayload(rawPayload({ kind: 'OPENING' }))).toThrow(
      PayloadValidationError,
    );
  });

  it('rejeita kind desconhecido', () => {
    expect(() => parseSubmitPayload(rawPayload({ kind: 'WHATEVER' }))).toThrow(
      PayloadValidationError,
    );
  });

  it('rejeita dinheiro que não seja string', () => {
    expect(() =>
      parseSubmitPayload(rawPayload({ money: { amount: 10.5, currency: 'BRL' } })),
    ).toThrow(PayloadValidationError);
  });

  it('rejeita dinheiro malformado', () => {
    expect(() =>
      parseSubmitPayload(rawPayload({ money: { amount: '-10.00', currency: 'BRL' } })),
    ).toThrow(PayloadValidationError);
    expect(() =>
      parseSubmitPayload(rawPayload({ money: { amount: '10.005', currency: 'BRL' } })),
    ).toThrow(PayloadValidationError);
  });

  it('rejeita moeda com formato inválido', () => {
    expect(() =>
      parseSubmitPayload(rawPayload({ money: { amount: '10.00', currency: 'real' } })),
    ).toThrow(PayloadValidationError);
    expect(() =>
      parseSubmitPayload(rawPayload({ money: { amount: '10.00', currency: 'brl' } })),
    ).toThrow(PayloadValidationError);
  });

  it('rejeita referência em branco', () => {
    expect(() =>
      parseSubmitPayload(rawPayload({ referenceExternalTransactionId: '   ' })),
    ).toThrow(PayloadValidationError);
  });

  it('acumula vários problemas em uma única exceção', () => {
    try {
      parseSubmitPayload(rawPayload({ providerId: undefined, kind: 'NOPE', money: undefined }));
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(PayloadValidationError);
      expect((error as PayloadValidationError).details.length).toBeGreaterThanOrEqual(3);
    }
  });
});
