import { WalletLedgerEntry } from '../../domain/wallet-ledger-entry.js';
import type { WalletLedgerEntryRow } from './rows.js';

export function toWalletLedgerEntryRow(entry: WalletLedgerEntry): WalletLedgerEntryRow {
  const { amount, currency } = entry.money.toJSON();
  const balanceBefore = entry.balanceBefore.toJSON().amount;
  const balanceAfter = entry.balanceAfter.toJSON().amount;
  return {
    id: entry.id,
    walletId: entry.walletId,
    transactionId: entry.transactionId,
    direction: entry.direction,
    amount,
    currency,
    balanceBefore,
    balanceAfter,
    createdAt: entry.createdAt,
  };
}

export function toWalletLedgerEntry(row: WalletLedgerEntryRow): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate({
    id: row.id,
    walletId: row.walletId,
    transactionId: row.transactionId,
    direction: row.direction,
    money: { amount: row.amount, currency: row.currency },
    balanceBefore: { amount: row.balanceBefore, currency: row.currency },
    balanceAfter: { amount: row.balanceAfter, currency: row.currency },
    createdAt: row.createdAt,
  });
}