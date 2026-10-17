import { EntitySchema } from '@mikro-orm/core';
import type { WalletLedgerEntryRow, WalletRow, WagerTransactionRow } from './rows.js';

export const WalletSchema = new EntitySchema<WalletRow>({
  name: 'WalletRow',
  tableName: 'wallets',
  properties: {
    id: { type: 'uuid', primary: true },
    playerId: { type: 'string', columnType: 'text', fieldName: 'player_id' },
    currency: { type: 'string', columnType: 'text' },
    balance: { type: 'string', columnType: 'numeric(19,2)' },
    version: { type: 'number', columnType: 'integer' },
    createdAt: { type: 'Date', columnType: 'timestamptz', fieldName: 'created_at' },
    updatedAt: { type: 'Date', columnType: 'timestamptz', fieldName: 'updated_at' },
  },
});

export const WagerTransactionSchema = new EntitySchema<WagerTransactionRow>({
  name: 'WagerTransactionRow',
  tableName: 'wager_transactions',
  properties: {
    id: { type: 'uuid', primary: true },
    providerId: { type: 'string', columnType: 'text', fieldName: 'provider_id' },
    externalTransactionId: {
      type: 'string',
      columnType: 'text',
      fieldName: 'external_transaction_id',
    },
    idempotencyKey: { type: 'string', columnType: 'text', fieldName: 'idempotency_key' },
    payloadHash: { type: 'string', columnType: 'text', fieldName: 'payload_hash' },
    walletId: { type: 'uuid', fieldName: 'wallet_id' },
    playerId: { type: 'string', columnType: 'text', fieldName: 'player_id' },
    roundId: { type: 'string', columnType: 'text', fieldName: 'round_id' },
    gameId: { type: 'string', columnType: 'text', fieldName: 'game_id' },
    kind: { type: 'string', columnType: 'text' },
    amount: { type: 'string', columnType: 'numeric(19,2)' },
    currency: { type: 'string', columnType: 'text' },
    referenceExternalTransactionId: {
      type: 'string',
      columnType: 'text',
      fieldName: 'reference_external_transaction_id',
      nullable: true,
    },
    referenceTransactionId: {
      type: 'uuid',
      fieldName: 'reference_transaction_id',
      nullable: true,
    },
    status: { type: 'string', columnType: 'text' },
    failureCode: {
      type: 'string',
      columnType: 'text',
      fieldName: 'failure_code',
      nullable: true,
    },
    createdAt: { type: 'Date', columnType: 'timestamptz', fieldName: 'created_at' },
    processedAt: {
      type: 'Date',
      columnType: 'timestamptz',
      fieldName: 'processed_at',
      nullable: true,
    },
  },
});

export const WalletLedgerEntrySchema = new EntitySchema<WalletLedgerEntryRow>({
  name: 'WalletLedgerEntryRow',
  tableName: 'wallet_ledger_entries',
  properties: {
    id: { type: 'uuid', primary: true },
    walletId: { type: 'uuid', fieldName: 'wallet_id' },
    transactionId: { type: 'uuid', fieldName: 'transaction_id' },
    direction: { type: 'string', columnType: 'text' },
    amount: { type: 'string', columnType: 'numeric(19,2)' },
    currency: { type: 'string', columnType: 'text' },
    balanceBefore: {
      type: 'string',
      columnType: 'numeric(19,2)',
      fieldName: 'balance_before',
    },
    balanceAfter: {
      type: 'string',
      columnType: 'numeric(19,2)',
      fieldName: 'balance_after',
    },
    createdAt: { type: 'Date', columnType: 'timestamptz', fieldName: 'created_at' },
  },
});