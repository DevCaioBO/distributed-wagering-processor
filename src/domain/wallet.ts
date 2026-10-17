import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidWalletError,
} from './errors.js';
import { Money, type MoneyProps } from './money.js';
import { LedgerDirection, WalletLedgerEntry } from './wallet-ledger-entry.js';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  opening?: { entryId: string; transactionId: string };
  now?: Date;
}

export interface OpenedWallet {
  wallet: Wallet;
  openingEntry?: WalletLedgerEntry;
}

export interface ApplyMovementInput {
  entryId: string;
  transactionId: string;
  money: Money;
  now: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): OpenedWallet {
    const { initialBalance } = props;
    if (initialBalance.isNegative()) {
      throw new InvalidWalletError('Initial balance cannot be negative');
    }

    const now = props.now ?? new Date();
    const wallet = new Wallet(
      props.id,
      props.playerId,
      initialBalance.currency,
      initialBalance,
      1,
      now,
      now,
    );

    if (initialBalance.isZero()) {
      return { wallet };
    }
    if (!props.opening) {
      throw new InvalidWalletError(
        'Opening entry data is required when initial balance is positive',
      );
    }

    const openingEntry = WalletLedgerEntry.create({
      id: props.opening.entryId,
      walletId: props.id,
      transactionId: props.opening.transactionId,
      direction: LedgerDirection.Credit,
      money: initialBalance,
      balanceBefore: Money.zero(initialBalance.currency),
      balanceAfter: initialBalance,
      createdAt: now,
    });
    return { wallet, openingEntry };
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from(state.balance),
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(input: ApplyMovementInput): WalletLedgerEntry {
    this.assertMovement(input.money);
    if (this._balance.isLessThan(input.money)) {
      throw new InsufficientFundsError(this._balance.toString(), input.money.toString());
    }
    return this.apply(LedgerDirection.Debit, this._balance.subtract(input.money), input);
  }

  credit(input: ApplyMovementInput): WalletLedgerEntry {
    this.assertMovement(input.money);
    return this.apply(LedgerDirection.Credit, this._balance.add(input.money), input);
  }

  private apply(
    direction: LedgerDirection,
    balanceAfter: Money,
    input: ApplyMovementInput,
  ): WalletLedgerEntry {
    const entry = WalletLedgerEntry.create({
      id: input.entryId,
      walletId: this.id,
      transactionId: input.transactionId,
      direction,
      money: input.money,
      balanceBefore: this._balance,
      balanceAfter,
      createdAt: input.now,
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = input.now;
    return entry;
  }

  private assertMovement(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
    if (!money.isPositive()) {
      throw new InvalidWalletError('Movement amount must be positive');
    }
  }
}