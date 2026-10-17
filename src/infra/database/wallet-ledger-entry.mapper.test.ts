import { describe, expect, it } from 'bun:test';
import { InvalidMoneyError } from '../../domain/errors.js';
import { Money } from '../../domain/money.js';
import { LedgerDirection, WalletLedgerEntry } from '../../domain/wallet-ledger-entry.js';
import type { WalletLedgerEntryRow } from './rows.js';
import {
  toWalletLedgerEntry,
  toWalletLedgerEntryRow,
} from './wallet-ledger-entry.mapper.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const now = new Date('2026-01-01T00:00:00.000Z');

const makeEntry = () =>
  WalletLedgerEntry.create({
    id: '0192f298-345e-7e38-af88-e43f851a819d',
    walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
    transactionId: '0192f298-345e-7e38-af88-e43f851a8300',
    direction: LedgerDirection.Debit,
    money: brl('80.00'),
    balanceBefore: brl('100.00'),
    balanceAfter: brl('20.00'),
    createdAt: now,
  });

describe('wallet ledger entry mapper', () => {
  it('converte lançamento em linha com valores string', () => {
    const row = toWalletLedgerEntryRow(makeEntry());
    expect(row.amount).toBe('80.00');
    expect(row.balanceBefore).toBe('100.00');
    expect(row.balanceAfter).toBe('20.00');
    expect(row.direction).toBe(LedgerDirection.Debit);
    expect(typeof row.amount).toBe('string');
  });

  it('ida e volta preserva o lançamento', () => {
    const entry = makeEntry();
    const restored = toWalletLedgerEntry(toWalletLedgerEntryRow(entry));
    expect(restored.isBalanced()).toBe(true);
    expect(restored.money.equals(brl('80.00'))).toBe(true);
    expect(restored.balanceAfter.equals(brl('20.00'))).toBe(true);
  });

  it('rejeita amount que chegou como number', () => {
    const row = {
      ...toWalletLedgerEntryRow(makeEntry()),
      amount: 80 as unknown as string,
    } satisfies WalletLedgerEntryRow;
    expect(() => toWalletLedgerEntry(row)).toThrow(InvalidMoneyError);
  });
});