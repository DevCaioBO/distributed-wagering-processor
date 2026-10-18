import { describe, expect, it } from 'bun:test';
import { FailureCode } from '../failure-code.js';
import { Money } from '../money.js';
import { Wallet } from '../wallet.js';
import { LedgerDirection } from '../wallet-ledger-entry.js';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from '../wager-transaction.js';
import { WagerTransactionPendingReference } from './wager-transaction-pending-reference.js';
import { WagerTransactionProcessed } from './wager-transaction-processed.js';
import { WagerTransactionRejected } from './wager-transaction-rejected.js';
import { WalletBalanceChanged } from './wallet-balance-changed.js';
import type { EventContext } from './integration-event.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const now = new Date('2026-01-01T00:00:00.000Z');
const ctx: EventContext = { eventId: 'evt-1', correlationId: 'corr-1', occurredAt: now };

const { wallet, openingEntry } = Wallet.open({
  id: 'wallet-1',
  playerId: 'player-1',
  initialBalance: brl('100.00'),
  opening: { entryId: 'entry-0', transactionId: 'tx-0' },
  now,
});

const bet = WagerTransaction.create({
  id: 'tx-1',
  providerId: 'provider-a',
  externalTransactionId: 'bet-1',
  idempotencyKey: 'provider-a:bet-1',
  payloadHash: 'hash-1',
  walletId: 'wallet-1',
  playerId: 'player-1',
  roundId: 'round-1',
  gameId: 'fortune-chimp',
  kind: WagerTransactionKind.Bet,
  money: brl('25.00'),
  createdAt: now,
});

describe('IntegrationEvent (envelope)', () => {
  it('toJSON devolve o envelope com occurredAt ISO e version no tipo', () => {
    const event = WalletBalanceChanged.from(wallet, openingEntry!, ctx);
    expect(event.toJSON()).toEqual({
      eventId: 'evt-1',
      eventType: 'WalletBalanceChanged',
      aggregateId: 'wallet-1',
      correlationId: 'corr-1',
      occurredAt: now.toISOString(),
      version: 1,
      data: {
        walletId: 'wallet-1',
        transactionId: 'tx-0',
        direction: LedgerDirection.Credit,
        money: { amount: '100.00', currency: 'BRL' },
        balanceBefore: { amount: '0.00', currency: 'BRL' },
        balanceAfter: { amount: '100.00', currency: 'BRL' },
        walletVersion: 1,
      },
    });
  });

  it('inclui causationId somente quando informado', () => {
    const withCausation = WalletBalanceChanged.from(wallet, openingEntry!, {
      ...ctx,
      causationId: 'msg-1',
    });
    expect(withCausation.toJSON().causationId).toBe('msg-1');
    const withoutCausation = WalletBalanceChanged.from(wallet, openingEntry!, ctx);
    expect('causationId' in withoutCausation.toJSON()).toBe(false);
  });

  it('data é somente leitura e congelado', () => {
    const event = WalletBalanceChanged.from(wallet, openingEntry!, ctx);
    expect(Object.isFrozen(event.data)).toBe(true);
  });

  it('JSON do payload é estável: o envelope serializa como o próprio toJSON', () => {
    const event = WalletBalanceChanged.from(wallet, openingEntry!, ctx);
    expect(JSON.parse(JSON.stringify(event))).toEqual(JSON.parse(JSON.stringify(event.toJSON())));
  });
});

describe('WagerTransactionProcessed', () => {
  it('carrega o saldo observado no momento da aplicação', () => {
    const event = WagerTransactionProcessed.from(bet, brl('75.00'), ctx);
    expect(event.eventType).toBe('WagerTransactionProcessed');
    expect(event.version).toBe(1);
    expect(event.aggregateId).toBe('tx-1');
    expect(event.data.kind).toBe(WagerTransactionKind.Bet);
    expect(event.data.balance).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(event.data.referenceExternalTransactionId).toBeUndefined();
  });

  it('propaga a referência quando existe', () => {
    const refund = WagerTransaction.create({
      id: 'tx-2',
      providerId: 'provider-a',
      externalTransactionId: 'refund-1',
      idempotencyKey: 'provider-a:refund-1',
      payloadHash: 'hash-2',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: brl('25.00'),
      referenceExternalTransactionId: 'bet-1',
      createdAt: now,
    });
    refund.markProcessed('tx-1', now);
    const event = WagerTransactionProcessed.from(refund, brl('100.00'), ctx);
    expect(event.data.referenceExternalTransactionId).toBe('bet-1');
    expect(event.data.referenceTransactionId).toBe('tx-1');
  });
});

describe('WagerTransactionRejected', () => {
  it('carrega o failureCode e a ação esperada do provedor', () => {
    const rejected = WagerTransaction.rehydrate({
      id: 'tx-3',
      providerId: 'provider-a',
      externalTransactionId: 'bet-3',
      idempotencyKey: 'provider-a:bet-3',
      payloadHash: 'hash-3',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: { amount: '10.00', currency: 'BRL' },
      createdAt: now,
      status: WagerTransactionStatus.Rejected,
      failureCode: FailureCode.InsufficientFunds,
    });
    const event = WagerTransactionRejected.from(rejected, ctx);
    expect(event.data.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(event.data.providerAction).toBe('ABANDON');
  });

  it('recusa transação sem failureCode', () => {
    expect(() => WagerTransactionRejected.from(bet, ctx)).toThrow();
  });
});

describe('WagerTransactionPendingReference', () => {
  const pending = WagerTransaction.rehydrate({
    id: 'tx-4',
    providerId: 'provider-a',
    externalTransactionId: 'refund-4',
    idempotencyKey: 'provider-a:refund-4',
    payloadHash: 'hash-4',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'fortune-chimp',
    kind: WagerTransactionKind.Refund,
    money: { amount: '25.00', currency: 'BRL' },
    referenceExternalTransactionId: 'bet-1',
    createdAt: now,
    status: WagerTransactionStatus.PendingReference,
  });

  it('carrega a referência externa aguardada', () => {
    const event = WagerTransactionPendingReference.from(pending, ctx);
    expect(event.eventType).toBe('WagerTransactionPendingReference');
    expect(event.data.referenceExternalTransactionId).toBe('bet-1');
  });

  it('recusa transação fora de PENDING_REFERENCE', () => {
    expect(() => WagerTransactionPendingReference.from(bet, ctx)).toThrow();
  });
});
