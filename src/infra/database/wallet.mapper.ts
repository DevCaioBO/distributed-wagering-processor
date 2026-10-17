import { Wallet } from '../../domain/wallet.js';
import type { WalletRow } from './rows.js';

export function toWalletRow(wallet: Wallet): WalletRow {
  const { amount, currency } = wallet.balance.toJSON();
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    currency: wallet.currency,
    balance: amount,
    version: wallet.version,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

export function toWallet(row: WalletRow): Wallet {
  return Wallet.rehydrate({
    id: row.id,
    playerId: row.playerId,
    currency: row.currency,
    balance: { amount: row.balance, currency: row.currency },
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}