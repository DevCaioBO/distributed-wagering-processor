import type { MoneyProps } from '../money.js';
import { WagerTransactionStatus, type WagerTransaction } from '../wager-transaction.js';
import { IntegrationEvent, type EventContext } from './integration-event.js';

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId: string;
}

/** Publicado quando uma transação entra em PENDING_REFERENCE (referência ausente). */
export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionPendingReference {
    if (transaction.status !== WagerTransactionStatus.PendingReference) {
      throw new Error('A pending-reference event needs a transaction in PENDING_REFERENCE');
    }
    if (transaction.referenceExternalTransactionId === undefined) {
      throw new Error('A pending-reference event needs a referenceExternalTransactionId');
    }
    return new WagerTransactionPendingReference({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        transactionId: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        roundId: transaction.roundId,
        gameId: transaction.gameId,
        kind: transaction.kind,
        money: transaction.money.toJSON(),
        referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      },
    });
  }
}
