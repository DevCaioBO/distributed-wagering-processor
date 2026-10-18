import { InvalidInboxMessageError } from './errors.js';

export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface InboxMessageState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
}

/**
 * Registro persistente de uma mensagem recebida (dedup do consumidor).
 *
 * A unicidade é `(consumerName, messageId)`: a linha só existe se o
 * processamento dela foi COMMITADO junto com o efeito financeiro — linha
 * ausente significa "nunca processada" ou "processamento abortado".
 */
export class InboxMessage {
  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt?: Date,
  ) {}

  static receive(props: ReceiveInboxProps): InboxMessage {
    for (const field of ['messageId', 'consumerName', 'payloadHash'] as const) {
      const value = props[field];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new InvalidInboxMessageError(`${field} is required`);
      }
    }
    if (!(props.receivedAt instanceof Date) || Number.isNaN(props.receivedAt.getTime())) {
      throw new InvalidInboxMessageError('receivedAt must be a valid Date');
    }
    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt,
    );
  }

  /** Reconstrução a partir da persistência — não revalida regras. */
  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) {
      throw new InvalidInboxMessageError(`Inbox message ${this.messageId} is already processed`);
    }
    this._processedAt = at;
  }
}
