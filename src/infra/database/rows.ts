import type { FailureCode } from '../../domain/failure-code.js';
import type { LedgerDirection } from '../../domain/wallet-ledger-entry.js';
import type {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction.js';

export interface WalletRow {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WagerTransactionRow {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  status: WagerTransactionStatus;
  failureCode: FailureCode | null;
  createdAt: Date;
  processedAt: Date | null;
  /** Saldo observado da wallet no momento da aplicação — usado no replay. */
  balanceAfter: string | null;
  /** Tentativas de resolução da referência ausentes (worker da seção 7.1). */
  referenceAttempts: number;
  nextAttemptAt: Date | null;
}

export interface InboxMessageRow {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface OutboxMessageRow {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | null;
  publishedAt: Date | null;
}

export interface WalletLedgerEntryRow {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  createdAt: Date;
}