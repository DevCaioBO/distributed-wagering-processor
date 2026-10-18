import { describe, expect, it } from 'bun:test';
import { canonicalJson, hashRawBody, payloadHashOf } from '../../src/application/payload-hash.js';
import type { ParsedSubmitPayload } from '../../src/application/submit-payload.js';
import { Money } from '../../src/domain/money.js';
import { WagerTransactionKind } from '../../src/domain/wager-transaction.js';

function makeParsed(overrides: Partial<ParsedSubmitPayload> = {}): ParsedSubmitPayload {
  return {
    providerId: 'prov-1',
    externalTransactionId: 'tx-1',
    playerId: 'player-1',
    walletId: '0190f0d8-0000-7000-8000-000000000001',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '10.00', currency: 'BRL' }),
    referenceExternalTransactionId: undefined,
    ...overrides,
  };
}

describe('canonicalJson', () => {
  it('ordena as chaves recursivamente', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserva a ordem de arrays', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('omite chaves com valor undefined', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('payloadHashOf', () => {
  it('produz sempre um sha256 hex de 64 caracteres', () => {
    expect(payloadHashOf(makeParsed())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignora a representação do dinheiro ("10.5" = "10.50")', () => {
    const a = makeParsed({ money: Money.from({ amount: '10.5', currency: 'BRL' }) });
    const b = makeParsed({ money: Money.from({ amount: '10.50', currency: 'BRL' }) });

    expect(payloadHashOf(a)).toBe(payloadHashOf(b));
  });

  it('muda quando um campo de negócio muda', () => {
    const base = makeParsed();
    const other = makeParsed({ roundId: 'round-2' });

    expect(payloadHashOf(base)).not.toBe(payloadHashOf(other));
  });

  it('muda quando a referência declarada muda', () => {
    const semReferencia = makeParsed();
    const comReferencia = makeParsed({ referenceExternalTransactionId: 'tx-0' });

    expect(payloadHashOf(semReferencia)).not.toBe(payloadHashOf(comReferencia));
  });

  it('muda quando o kind muda', () => {
    const bet = makeParsed();
    const win = makeParsed({ kind: WagerTransactionKind.Win });

    expect(payloadHashOf(bet)).not.toBe(payloadHashOf(win));
  });

  it('é determinístico para o mesmo input', () => {
    expect(payloadHashOf(makeParsed())).toBe(payloadHashOf(makeParsed()));
  });
});

describe('hashRawBody', () => {
  it('é sha256 do corpo bruto', () => {
    expect(hashRawBody('{"a":1}')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('muda com o corpo', () => {
    expect(hashRawBody('{"a":1}')).not.toBe(hashRawBody('{"a":2}'));
  });
});
