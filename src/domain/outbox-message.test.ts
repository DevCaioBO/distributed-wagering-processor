import { describe, expect, it } from 'bun:test';
import { IntegrationEvent } from './events/integration-event.js';
import { InvalidOutboxMessageError } from './errors.js';
import {
  OutboxMessage,
  OUTBOX_BASE_BACKOFF_MS,
  OUTBOX_MAX_BACKOFF_MS,
} from './outbox-message.js';

const occurredAt = new Date('2026-01-01T00:00:00.000Z');
const now = new Date('2026-01-01T00:00:10.000Z');

class TestEvent extends IntegrationEvent<{ walletId: string }> {
  readonly eventType = 'TestEvent';
  readonly version = 1;

  static create(): TestEvent {
    return new TestEvent({
      eventId: 'event-1',
      aggregateId: 'wallet-1',
      correlationId: 'corr-1',
      occurredAt,
      data: { walletId: 'wallet-1' },
    });
  }
}

describe('OutboxMessage.enqueue', () => {
  it('grava o envelope serializado como payload', () => {
    const message = OutboxMessage.enqueue(TestEvent.create(), { id: 'out-1' });
    expect(message.id).toBe('out-1');
    expect(message.aggregateId).toBe('wallet-1');
    expect(message.eventType).toBe('TestEvent');
    expect(message.payload).toEqual({
      eventId: 'event-1',
      eventType: 'TestEvent',
      aggregateId: 'wallet-1',
      correlationId: 'corr-1',
      occurredAt: occurredAt.toISOString(),
      version: 1,
      data: { walletId: 'wallet-1' },
    });
    expect(message.occurredAt).toEqual(occurredAt);
    expect(message.isPending()).toBe(true);
    expect(message.attempts).toBe(0);
  });

  it('começa sem data de retry (deve estar vencida logo)', () => {
    const message = OutboxMessage.enqueue(TestEvent.create(), { id: 'out-1' });
    expect(message.nextAttemptAt).toBeUndefined();
    expect(message.isDue(now)).toBe(true);
  });

  it('rejeita id vazio', () => {
    expect(() => OutboxMessage.enqueue(TestEvent.create(), { id: ' ' })).toThrow(
      InvalidOutboxMessageError,
    );
  });
});

describe('OutboxMessage publicação', () => {
  const pending = () => OutboxMessage.enqueue(TestEvent.create(), { id: 'out-1' });

  it('markPublished registra a publicação e a mensagem deixa de estar pendente', () => {
    const message = pending();
    message.markPublished(now);
    expect(message.publishedAt).toEqual(now);
    expect(message.isPending()).toBe(false);
    expect(message.isDue(now)).toBe(false);
  });

  it('markPublished duplo é erro de programação', () => {
    const message = pending();
    message.markPublished(now);
    expect(() => message.markPublished(now)).toThrow(InvalidOutboxMessageError);
  });

  it('scheduleRetry incrementa attempts e agenda backoff exponencial', () => {
    const message = pending();
    message.scheduleRetry(now);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt?.getTime()).toBe(now.getTime() + OUTBOX_BASE_BACKOFF_MS);
    expect(message.isDue(now)).toBe(false);

    message.scheduleRetry(now);
    expect(message.attempts).toBe(2);
    expect(message.nextAttemptAt?.getTime()).toBe(now.getTime() + OUTBOX_BASE_BACKOFF_MS * 2);
  });

  it('scheduleRetry tem teto de backoff', () => {
    const message = pending();
    for (let i = 0; i < 10; i += 1) {
      message.scheduleRetry(now);
    }
    expect(message.attempts).toBe(10);
    expect(message.nextAttemptAt?.getTime()).toBe(now.getTime() + OUTBOX_MAX_BACKOFF_MS);
  });

  it('isDue considera vencida quando nextAttemptAt já passou', () => {
    const message = pending();
    message.scheduleRetry(now);
    const later = new Date(now.getTime() + OUTBOX_BASE_BACKOFF_MS + 1);
    expect(message.isDue(later)).toBe(true);
  });
});

describe('OutboxMessage.rehydrate', () => {
  it('reconstrói tentativas e estado de publicação', () => {
    const message = OutboxMessage.rehydrate({
      id: 'out-2',
      aggregateId: 'wallet-2',
      eventType: 'TestEvent',
      payload: { eventId: 'e' },
      occurredAt,
      attempts: 3,
      nextAttemptAt: now,
    });
    expect(message.attempts).toBe(3);
    expect(message.nextAttemptAt).toEqual(now);
    expect(message.isPending()).toBe(true);
    expect(message.isDue(new Date(now.getTime() + 1))).toBe(true);
  });
});
