import { describe, expect, it } from 'bun:test';
import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidWalletError,
} from './errors.js';
import { Money } from './money.js';
import { LedgerDirection, type WalletLedgerEntry } from './wallet-ledger-entry.js';
import { Wallet } from './wallet.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const now = new Date('2026-01-01T00:00:00.000Z');

const openWallet = (initial = '100.00') =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl(initial),
    opening: { entryId: 'entry-0', transactionId: 'tx-0' },
    now,
  });

const movement = (id: string, amount: string) => ({
  entryId: `entry-${id}`,
  transactionId: `tx-${id}`,
  money: brl(amount),
  now,
});

describe('Wallet.open', () => {
  it('abre com version 1 e gera o lançamento de abertura', () => {
    const { wallet, openingEntry } = openWallet('100.00');
    expect(wallet.version).toBe(1);
    expect(wallet.balance.toJSON().amount).toBe('100.00');
    expect(openingEntry?.direction).toBe(LedgerDirection.Credit);
    expect(openingEntry?.balanceBefore.isZero()).toBe(true);
    expect(openingEntry?.balanceAfter.equals(brl('100.00'))).toBe(true);
  });

  it('saldo inicial zero não gera lançamento', () => {
    const { wallet, openingEntry } = openWallet('0.00');
    expect(wallet.version).toBe(1);
    expect(openingEntry).toBeUndefined();
  });

  it('rejeita saldo inicial positivo sem dados de abertura', () => {
    expect(() =>
      Wallet.open({ id: 'w', playerId: 'p', initialBalance: brl('10.00'), now }),
    ).toThrow(InvalidWalletError);
  });

  it('rejeita saldo inicial negativo', () => {
    expect(() =>
      Wallet.open({
        id: 'w',
        playerId: 'p',
        initialBalance: brl('1.00').subtract(brl('2.00')),
        now,
      }),
    ).toThrow(InvalidWalletError);
  });
});

describe('Wallet.debit', () => {
  it('debita, devolve o lançamento e incrementa a version', () => {
    const { wallet } = openWallet('100.00');
    const entry = wallet.debit(movement('1', '80.00'));
    expect(wallet.balance.toJSON().amount).toBe('20.00');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceBefore.equals(brl('100.00'))).toBe(true);
    expect(entry.balanceAfter.equals(wallet.balance)).toBe(true);
    expect(entry.isBalanced()).toBe(true);
  });

  it('saldo insuficiente lança erro e não altera nada', () => {
    const { wallet } = openWallet('100.00');
    expect(() => wallet.debit(movement('1', '100.01'))).toThrow(InsufficientFundsError);
    expect(wallet.balance.toJSON().amount).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('permite zerar o saldo', () => {
    const { wallet } = openWallet('100.00');
    wallet.debit(movement('1', '100.00'));
    expect(wallet.balance.isZero()).toBe(true);
  });

  it('cenário do desafio, em sequência: 100 com duas apostas de 80', () => {
    const { wallet } = openWallet('100.00');
    wallet.debit(movement('1', '80.00'));
    expect(() => wallet.debit(movement('2', '80.00'))).toThrow(InsufficientFundsError);
    expect(wallet.balance.toJSON().amount).toBe('20.00');
  });

  it('rejeita moeda diferente da wallet', () => {
    const { wallet } = openWallet('100.00');
    const usd = { ...movement('1', '10.00'), money: Money.from({ amount: '10.00', currency: 'USD' }) };
    expect(() => wallet.debit(usd)).toThrow(CurrencyMismatchError);
  });

  it('rejeita valor zero', () => {
    const { wallet } = openWallet('100.00');
    const zero = { ...movement('1', '0.00'), money: Money.zero('BRL') };
    expect(() => wallet.debit(zero)).toThrow(InvalidWalletError);
  });
});

describe('Wallet.credit', () => {
  it('credita, devolve o lançamento e incrementa a version', () => {
    const { wallet } = openWallet('100.00');
    const entry = wallet.credit(movement('1', '25.50'));
    expect(wallet.balance.toJSON().amount).toBe('125.50');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.isBalanced()).toBe(true);
  });
});

describe('Wallet e ledger', () => {
  it('o saldo final é reconstruído somando os lançamentos', () => {
    const { wallet, openingEntry } = openWallet('100.00');
    const debit = wallet.debit(movement('1', '30.00'));
    const credit = wallet.credit(movement('2', '10.50'));

    const entries = [openingEntry, debit, credit].filter(
      (entry): entry is WalletLedgerEntry => entry !== undefined,
    );
    const rebuilt = entries.reduce(
      (acc, entry) =>
        entry.direction === LedgerDirection.Credit ? acc.add(entry.money) : acc.subtract(entry.money),
      Money.zero('BRL'),
    );

    expect(rebuilt.equals(wallet.balance)).toBe(true);
  });
});

describe('Wallet.rehydrate', () => {
  it('reconstrói o estado persistido', () => {
    const wallet = Wallet.rehydrate({
      id: 'w',
      playerId: 'p',
      currency: 'BRL',
      balance: { amount: '20.00', currency: 'BRL' },
      version: 7,
      createdAt: now,
      updatedAt: now,
    });
    expect(wallet.version).toBe(7);
    expect(wallet.balance.equals(brl('20.00'))).toBe(true);
  });
});