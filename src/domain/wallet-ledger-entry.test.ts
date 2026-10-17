import { describe, expect, it } from 'bun:test';
import { InvalidLedgerEntryError } from './errors.js';
import { Money } from './money.js';
import { LedgerDirection, WalletLedgerEntry } from './wallet-ledger-entry.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

const base = {
  id: 'entry-1',
  walletId: 'wallet-1',
  transactionId: 'tx-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('WalletLedgerEntry', () => {
  it('cria débito consistente', () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.Debit,
      money: brl('80.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('20.00'),
    });
    expect(entry.isBalanced()).toBe(true);
    expect(entry.balanceAfter.toJSON().amount).toBe('20.00');
  });

  it('cria crédito consistente', () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.Credit,
      money: brl('25.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('125.00'),
    });
    expect(entry.isBalanced()).toBe(true);
  });

  it('rejeita aritmética que não fecha', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Debit,
        money: brl('80.00'),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('30.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejeita direção incompatível com os saldos', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Credit,
        money: brl('80.00'),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('20.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejeita valor zero', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Credit,
        money: Money.zero('BRL'),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('100.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejeita saldo final negativo', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Debit,
        money: brl('150.00'),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('100.00').subtract(brl('150.00')),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejeita moedas misturadas', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: '10.00', currency: 'USD' }),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('110.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rehydrate reconstrói o estado persistido', () => {
    const entry = WalletLedgerEntry.rehydrate({
      ...base,
      direction: LedgerDirection.Debit,
      money: { amount: '80.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '20.00', currency: 'BRL' },
    });
    expect(entry.isBalanced()).toBe(true);
    expect(entry.money.equals(brl('80.00'))).toBe(true);
  });
});