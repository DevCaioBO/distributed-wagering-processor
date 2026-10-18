import { InboxMessage } from '../../domain/inbox-message.js';
import type { InboxMessageRow } from './rows.js';

export function toInboxMessageRow(message: InboxMessage): InboxMessageRow {
  return {
    messageId: message.messageId,
    consumerName: message.consumerName,
    payloadHash: message.payloadHash,
    receivedAt: message.receivedAt,
    processedAt: message.processedAt ?? null,
  };
}

export function toInboxMessage(row: InboxMessageRow): InboxMessage {
  return InboxMessage.rehydrate({
    messageId: row.messageId,
    consumerName: row.consumerName,
    payloadHash: row.payloadHash,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt ?? undefined,
  });
}
