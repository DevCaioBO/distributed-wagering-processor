import { describe, expect, it } from 'bun:test';
import { InvalidMoneyError } from '../../domain/errors.js';
import { Money } from '../../domain/money.js';
import { Wallet } from '../../domain/wallet.js';
import type { WalletRow } from './rows.js';
import { toWallet, toWalletRow } from './wallet.mapper.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const now = new Date('2026-01-01T00:00:00.000Z');

const open = (initial = '100.00') =>
  Wallet.open({
    id: '0192f291-27dd-7d3f-8071-5f8685deef37',
    playerId: 'player-1',
    initialBalance: brl(initial),
    opening: {
      entryId: '0192f298-345e-7e38-af88-e43f851a819d',
      transactionId: '0192f298-345e-7e38-af88-e43f851a8300',
    },
    now,
  }).wallet;

describe('wallet mapper', () => {
  it('converte wallet em linha com balance string de duas casas', () => {
    const row = toWalletRow(open());
    expect(row.balance).toBe('100.00');
    expect(row.currency).toBe('BRL');
    expect(row.version).toBe(1);
    expect(typeof row.balance).toBe('string');
  });

  it('ida e volta preserva o estado', () => {
    const wallet = open('50.00');
    wallet.debit({
      entryId: 'e1',
      transactionId: 't1',
      money: brl('20.00'),
      now,
    });
    const restored = toWallet(toWalletRow(wallet));
    expect(restored.balance.equals(brl('30.00'))).toBe(true);
    expect(restored.version).toBe(2);
    expect(restored.playerId).toBe(wallet.playerId);
  });

  it('rejeita balance que chegou como number', () => {
    const row = {
      ...toWalletRow(open()),
      balance: 100 as unknown as string,
    } satisfies WalletRow;
    expect(() => toWallet(row)).toThrow(InvalidMoneyError);
  });
});