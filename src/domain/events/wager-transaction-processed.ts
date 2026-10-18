import type { Money, MoneyProps } from '../money.js';
import type { WagerTransaction } from '../wager-transaction.js';
import { IntegrationEvent, type EventContext } from './integration-event.js';

export interface WagerTransactionProcessedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  /** Saldo observado da wallet no momento em que a transação foi aplicada. */
  balance: MoneyProps;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
}

/** Publicado para toda transação aplicada, inclusive LOSS. */
export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    balance: Money,
    ctx: EventContext,
  ): WagerTransactionProcessed {
    const base = {
      transactionId: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      money: transaction.money.toJSON(),
      balance: balance.toJSON(),
    };
    const data: WagerTransactionProcessedData =
      transaction.referenceExternalTransactionId === undefined
        ? base
        : {
            ...base,
            referenceExternalTransactionId: transaction.referenceExternalTransactionId,
            ...(transaction.referenceTransactionId !== undefined
              ? { referenceTransactionId: transaction.referenceTransactionId }
              : {}),
          };
    return new WagerTransactionProcessed({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data,
    });
  }
}
