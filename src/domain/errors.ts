export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidMoneyError extends DomainError {}

export class CurrencyMismatchError extends DomainError {
  constructor(left: string, right: string) {
    super(`Currency mismatch: ${left} vs ${right}`);
  }
}

export class InvalidLedgerEntryError extends DomainError {}

export class InsufficientFundsError extends DomainError {
  constructor(balance: string, requested: string) {
    super(`Insufficient funds: balance ${balance}, requested ${requested}`);
  }
}

export class InvalidWalletError extends DomainError {}

export class InvalidWagerTransactionError extends DomainError {}

export class InvalidTransactionStateError extends DomainError {}