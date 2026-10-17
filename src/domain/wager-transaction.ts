import { InvalidTransactionStateError, InvalidWagerTransactionError } from './errors.js';
import { FailureCode } from './failure-code.js';
import { Money, type MoneyProps } from './money.js';
import { LedgerDirection } from './wallet-ledger-entry.js';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

const REQUIRED_TEXT_FIELDS = [
  'id',
  'providerId',
  'externalTransactionId',
  'idempotencyKey',
  'payloadHash',
  'walletId',
  'playerId',
  'roundId',
  'gameId',
] as const;

export const SYSTEM_PROVIDER_ID = 'system';

const OPENING_LABEL = 'opening';
const OPENING_PAYLOAD_HASH = 'opening';

const REFERENCE_REQUIRED_KINDS: ReadonlySet<WagerTransactionKind> = new Set([
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);

const ALLOWED_REFERENCE_KINDS: Partial<
  Record<WagerTransactionKind, readonly WagerTransactionKind[]>
> = {
  [WagerTransactionKind.Win]: [WagerTransactionKind.Bet],
  [WagerTransactionKind.Loss]: [WagerTransactionKind.Bet],
  [WagerTransactionKind.Refund]: [WagerTransactionKind.Bet],
  [WagerTransactionKind.Rollback]: [
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Refund,
  ],
};

function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export interface CreateWagerTransactionProps {
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
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

export interface CreateOpeningTransactionProps {
  id: string;
  walletId: string;
  playerId: string;
  money: Money;
  createdAt: Date;
}

export interface WagerTransactionState {
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
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    WagerTransaction.assertValid(props);
    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      WagerTransactionStatus.Pending,
    );
  }

  static createOpening(props: CreateOpeningTransactionProps): WagerTransaction {
    WagerTransaction.assertValidOpening(props);
    const externalKey = `${OPENING_LABEL}:${props.walletId}`;
    return new WagerTransaction(
      props.id,
      SYSTEM_PROVIDER_ID,
      externalKey,
      externalKey,
      OPENING_PAYLOAD_HASH,
      props.walletId,
      props.playerId,
      OPENING_LABEL,
      OPENING_LABEL,
      WagerTransactionKind.Opening,
      props.money,
      undefined,
      props.createdAt,
      WagerTransactionStatus.Processed,
      undefined,
      undefined,
      props.createdAt,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      Money.from(state.money),
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal('process');
    if (this.requiresReference() && referenceTransactionId === undefined) {
      throw new InvalidTransactionStateError(
        `${this.kind} cannot be processed without the internal id of its reference`,
      );
    }
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  markPendingReference(): void {
    this.assertNotTerminal('wait for a reference on');
    if (this.referenceExternalTransactionId === undefined) {
      throw new InvalidTransactionStateError(
        `${this.kind} does not declare a reference to wait for`,
      );
    }
    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal('reject');
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal('fail');
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return REFERENCE_REQUIRED_KINDS.has(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  validateReference(reference: WagerTransaction): FailureCode | undefined {
    if (
      this.referenceExternalTransactionId !== reference.externalTransactionId ||
      this.providerId !== reference.providerId ||
      this.playerId !== reference.playerId ||
      this.walletId !== reference.walletId ||
      this.roundId !== reference.roundId ||
      this.money.currency !== reference.money.currency
    ) {
      return FailureCode.ReferenceMismatch;
    }

    const allowedKinds = ALLOWED_REFERENCE_KINDS[this.kind];
    if (!allowedKinds || !allowedKinds.includes(reference.kind)) {
      return FailureCode.InvalidReferenceKind;
    }

    if (this.requiresReference() && !this.money.equals(reference.money)) {
      return FailureCode.AmountMismatch;
    }

    return undefined;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Opening:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Rollback:
        return this.rollbackDirection(reference);
      case WagerTransactionKind.Loss:
        throw new InvalidWagerTransactionError('LOSS does not move the balance');
    }
  }

  private rollbackDirection(reference?: WagerTransaction): LedgerDirection {
    if (!reference) {
      throw new InvalidWagerTransactionError('ROLLBACK needs its reference to know the direction');
    }
    switch (reference.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Debit;
      default:
        throw new InvalidWagerTransactionError(`ROLLBACK cannot reverse a ${reference.kind}`);
    }
  }

  private assertNotTerminal(action: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `Cannot ${action} a transaction that is already ${this._status}`,
      );
    }
  }

  private static assertValid(props: CreateWagerTransactionProps): void {
    for (const field of REQUIRED_TEXT_FIELDS) {
      if (!isFilled(props[field])) {
        throw new InvalidWagerTransactionError(`${field} is required`);
      }
    }

    if (props.providerId.trim() === SYSTEM_PROVIDER_ID) {
      throw new InvalidWagerTransactionError(`${SYSTEM_PROVIDER_ID} is a reserved provider id`);
    }

    if (!Object.values(WagerTransactionKind).includes(props.kind)) {
      throw new InvalidWagerTransactionError(`Unknown kind: ${String(props.kind)}`);
    }
    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvalidWagerTransactionError('OPENING is internal and cannot be submitted');
    }

    const reference = props.referenceExternalTransactionId;
    if (reference !== undefined && !isFilled(reference)) {
      throw new InvalidWagerTransactionError('referenceExternalTransactionId cannot be blank');
    }
    if (REFERENCE_REQUIRED_KINDS.has(props.kind) && reference === undefined) {
      throw new InvalidWagerTransactionError(`${props.kind} requires a reference`);
    }
    if (props.kind === WagerTransactionKind.Bet && reference !== undefined) {
      throw new InvalidWagerTransactionError('BET cannot have a reference');
    }

    const allowsZero = props.kind === WagerTransactionKind.Loss;
    if (props.money.isNegative() || (!allowsZero && props.money.isZero())) {
      throw new InvalidWagerTransactionError(`Invalid amount for ${props.kind}`);
    }
  }

  private static assertValidOpening(props: CreateOpeningTransactionProps): void {
    for (const field of ['id', 'walletId', 'playerId'] as const) {
      if (!isFilled(props[field])) {
        throw new InvalidWagerTransactionError(`${field} is required`);
      }
    }
    if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError('OPENING needs a positive amount');
    }
  }
}