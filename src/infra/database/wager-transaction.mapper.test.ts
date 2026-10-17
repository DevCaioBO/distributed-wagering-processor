import { describe, expect, it } from 'bun:test';
import { InvalidMoneyError } from '../../domain/errors.js';
import { FailureCode } from '../../domain/failure-code.js';
import { Money } from '../../domain/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction.js';
import type { WagerTransactionRow } from './rows.js';
import { toWagerTransaction, toWagerTransactionRow } from './wager-transaction.mapper.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const now = new Date('2026-01-01T00:00:00.000Z');
const later = new Date('2026-01-01T00:00:05.000Z');

const makeBet = () =>
  WagerTransaction.create({
    id: '0192f298-345e-7e38-af88-e43f851a819d',
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'provider-a:ext-1',
    payloadHash: 'hash-1',
    walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: brl('25.00'),
    createdAt: now,
  });

describe('wager transaction mapper', () => {
  it('converte uma transação pendente em linha com nulos explícitos', () => {
    const row = toWagerTransactionRow(makeBet());
    expect(row.amount).toBe('25.00');
    expect(row.currency).toBe('BRL');
    expect(row.status).toBe(WagerTransactionStatus.Pending);
    expect(row.referenceExternalTransactionId).toBeNull();
    expect(row.referenceTransactionId).toBeNull();
    expect(row.failureCode).toBeNull();
    expect(row.processedAt).toBeNull();
  });

  it('o valor sai sempre como string com duas casas, nunca como number', () => {
    const row = toWagerTransactionRow(makeBet());
    expect(typeof row.amount).toBe('string');
  });

  it('ida e volta preserva uma transação processada', () => {
    const bet = makeBet();
    bet.markProcessed(undefined, later);
    const restored = toWagerTransaction(toWagerTransactionRow(bet));
    expect(restored.status).toBe(WagerTransactionStatus.Processed);
    expect(restored.processedAt).toEqual(later);
    expect(restored.money.equals(brl('25.00'))).toBe(true);
    expect(restored.idempotencyKey).toBe(bet.idempotencyKey);
    expect(restored.isTerminal()).toBe(true);
  });

  it('ida e volta preserva uma rejeição com o código de falha', () => {
    const bet = makeBet();
    bet.reject(FailureCode.InsufficientFunds);
    const restored = toWagerTransaction(toWagerTransactionRow(bet));
    expect(restored.status).toBe(WagerTransactionStatus.Rejected);
    expect(restored.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(restored.processedAt).toBeUndefined();
  });

  it('ida e volta preserva a referência de um REFUND processado', () => {
    const refund = WagerTransaction.create({
      id: '0192f298-345e-7e38-af88-e43f851a8200',
      providerId: 'provider-a',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
      payloadHash: 'hash-2',
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Refund,
      money: brl('25.00'),
      referenceExternalTransactionId: 'ext-1',
      createdAt: now,
    });
    refund.markProcessed('0192f298-345e-7e38-af88-e43f851a819d', later);
    const restored = toWagerTransaction(toWagerTransactionRow(refund));
    expect(restored.referenceExternalTransactionId).toBe('ext-1');
    expect(restored.referenceTransactionId).toBe('0192f298-345e-7e38-af88-e43f851a819d');
  });

  it('ida e volta preserva a abertura interna', () => {
    const opening = WagerTransaction.createOpening({
      id: '0192f298-345e-7e38-af88-e43f851a8300',
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: 'player-1',
      money: brl('100.00'),
      createdAt: now,
    });
    const row = toWagerTransactionRow(opening);
    expect(row.kind).toBe(WagerTransactionKind.Opening);
    expect(row.providerId).toBe('system');
    expect(row.processedAt).toEqual(now);

    const restored = toWagerTransaction(row);
    expect(restored.kind).toBe(WagerTransactionKind.Opening);
    expect(restored.externalTransactionId).toBe(opening.externalTransactionId);
  });

  it('rejeita linha em que o valor chegou como number', () => {
    const row = {
      ...toWagerTransactionRow(makeBet()),
      amount: 25 as unknown as string,
    } satisfies WagerTransactionRow;
    expect(() => toWagerTransaction(row)).toThrow(InvalidMoneyError);
  });
});