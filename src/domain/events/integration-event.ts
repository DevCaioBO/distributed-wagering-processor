export interface IntegrationEventProps<T> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
  data: T;
}

/** Envelope serializado gravado no payload da outbox e no barramento. */
export interface IntegrationEventEnvelope<T> {
  eventId: string;
  eventType: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  version: number;
  data: T;
}

/** Contexto de correlação repassado pelos casos de uso aos factories dos eventos. */
export interface EventContext {
  eventId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
}

/**
 * Envelope de um evento de integração. `eventType` e `version` vivem no tipo,
 * não em uma string solta no call site, e o `data` é `Readonly` e congelado:
 * o payload precisa ser JSON estável e versionável.
 */
export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId: string | undefined;
  readonly occurredAt: Date;
  readonly data: Readonly<T>;

  protected constructor(props: IntegrationEventProps<T>) {
    IntegrationEvent.assertFilled('eventId', props.eventId);
    IntegrationEvent.assertFilled('aggregateId', props.aggregateId);
    IntegrationEvent.assertFilled('correlationId', props.correlationId);
    if (!(props.occurredAt instanceof Date) || Number.isNaN(props.occurredAt.getTime())) {
      throw new Error('occurredAt must be a valid Date');
    }
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt;
    this.data = Object.freeze({ ...props.data });
  }

  /** Envelope serializado gravado no payload da outbox. */
  toJSON(): IntegrationEventEnvelope<T> {
    const base: IntegrationEventEnvelope<T> = {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data,
    };
    return this.causationId === undefined ? base : { ...base, causationId: this.causationId };
  }

  private static assertFilled(field: string, value: string): void {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${field} is required`);
    }
  }
}
