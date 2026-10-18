import { providerActionFor, type FailureCode } from '../failure-code.js';
import type { MoneyProps } from '../money.js';
import type { WagerTransaction } from '../wager-transaction.js';
import { IntegrationEvent, type EventContext } from './integration-event.js';

export interface WagerTransactionRejectedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  failureCode: FailureCode;
  /** Ação que o provedor deve tomar segundo a taxonomia de falhas. */
  providerAction: string;
}

/** Publicado quando uma transação é rejeitada por regra de negócio. */
export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionRejected {
    if (transaction.failureCode === undefined) {
      throw new Error('A rejected transaction must carry a failureCode');
    }
    return new WagerTransactionRejected({
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
        failureCode: transaction.failureCode,
        providerAction: providerActionFor(transaction.failureCode),
      },
    });
  }
}
