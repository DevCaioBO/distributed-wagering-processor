export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  ReversalWouldOverdraw = 'REVERSAL_WOULD_OVERDRAW',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceMismatch = 'REFERENCE_MISMATCH',
  InvalidReferenceKind = 'INVALID_REFERENCE_KIND',
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  AlreadyReversed = 'ALREADY_REVERSED',
  AmountMismatch = 'AMOUNT_MISMATCH',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  WalletNotFound = 'WALLET_NOT_FOUND',
  WalletPlayerMismatch = 'WALLET_PLAYER_MISMATCH',
  ProcessingFailed = 'PROCESSING_FAILED',
}

export enum ProviderAction {
  Abandon = 'ABANDON',
  FixPayload = 'FIX_PAYLOAD',
  ContactSupport = 'CONTACT_SUPPORT',
}

const PROVIDER_ACTIONS: Record<FailureCode, ProviderAction> = {
  [FailureCode.InsufficientFunds]: ProviderAction.Abandon,
  [FailureCode.ReversalWouldOverdraw]: ProviderAction.ContactSupport,
  [FailureCode.ReferenceNotFound]: ProviderAction.FixPayload,
  [FailureCode.ReferenceMismatch]: ProviderAction.FixPayload,
  [FailureCode.InvalidReferenceKind]: ProviderAction.FixPayload,
  [FailureCode.ReferenceNotProcessed]: ProviderAction.Abandon,
  [FailureCode.AlreadyReversed]: ProviderAction.Abandon,
  [FailureCode.AmountMismatch]: ProviderAction.FixPayload,
  [FailureCode.CurrencyMismatch]: ProviderAction.FixPayload,
  [FailureCode.WalletNotFound]: ProviderAction.FixPayload,
  [FailureCode.WalletPlayerMismatch]: ProviderAction.FixPayload,
  [FailureCode.ProcessingFailed]: ProviderAction.ContactSupport,
};

export function providerActionFor(code: FailureCode): ProviderAction {
  return PROVIDER_ACTIONS[code];
}