import { InvalidOutboxMessageError } from './errors.js';
import { IntegrationEvent } from './events/integration-event.js';

export const OUTBOX_BASE_BACKOFF_MS = 1_000;
export const OUTBOX_MAX_BACKOFF_MS = 60_000;

export interface EnqueueOutboxProps {
  id: string;
}

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

/**
 * Evento de integração persistido na outbox. Entra na mesma transação SQL
 * da mudança financeira e só é publicado depois do commit por um worker.
 */
export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt: Date | undefined,
    private _publishedAt: Date | undefined,
  ) {}

  static enqueue(event: IntegrationEvent<unknown>, props: EnqueueOutboxProps): OutboxMessage {
    if (typeof props.id !== 'string' || props.id.trim() === '') {
      throw new InvalidOutboxMessageError('id is required');
    }
    const envelope = event.toJSON();
    return new OutboxMessage(
      props.id,
      event.aggregateId,
      event.eventType,
      Object.freeze({ ...envelope }),
      event.occurredAt,
      0,
      undefined,
      undefined,
    );
  }

  /** Reconstrução a partir da persistência — não revalida regras. */
  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      Object.freeze({ ...state.payload }),
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  /** Publicação vencida: ainda não publicada e sem data futura de retry. */
  isDue(now: Date): boolean {
    if (!this.isPending()) {
      return false;
    }
    return this._nextAttemptAt === undefined || this._nextAttemptAt <= now;
  }

  markPublished(at: Date): void {
    if (!this.isPending()) {
      throw new InvalidOutboxMessageError(`Outbox message ${this.id} is already published`);
    }
    this._publishedAt = at;
  }

  /** Incrementa attempts e calcula o próximo nextAttemptAt (backoff exponencial com teto). */
  scheduleRetry(now: Date): void {
    this._attempts += 1;
    const backoff = Math.min(
      OUTBOX_BASE_BACKOFF_MS * 2 ** (this._attempts - 1),
      OUTBOX_MAX_BACKOFF_MS,
    );
    this._nextAttemptAt = new Date(now.getTime() + backoff);
  }
}
