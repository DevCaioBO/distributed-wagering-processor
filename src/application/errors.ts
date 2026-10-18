/** Erros da camada de aplicação. Mapeados para HTTP pelo exception filter. */
export class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Payload inválido (validação de entrada) — nunca terá sucesso, provedor deve corrigir. */
export class PayloadValidationError extends ApplicationError {
  constructor(public readonly details: string[]) {
    super(`Invalid payload: ${details.join('; ')}`);
  }
}

/** Mesma idempotency key com payload diferente — conflito, não replay. */
export class IdempotencyConflictError extends ApplicationError {
  constructor(idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was used with a different payload`);
  }
}

/** Wallet duplicada para o mesmo playerId + currency. */
export class WalletAlreadyExistsError extends ApplicationError {
  constructor(playerId: string, currency: string) {
    super(`Wallet already exists for player ${playerId} and currency ${currency}`);
  }
}

export class WalletNotFoundError extends ApplicationError {
  constructor(walletId: string) {
    super(`Wallet ${walletId} not found`);
  }
}

export class WagerTransactionNotFoundError extends ApplicationError {
  constructor(lookup: string) {
    super(`Wager transaction ${lookup} not found`);
  }
}
