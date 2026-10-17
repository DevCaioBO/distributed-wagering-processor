import { describe, expect, it } from 'bun:test';
import { InvalidTransactionStateError, InvalidWagerTransactionError } from './errors.js';
import { FailureCode } from './failure-code.js';
import { Money } from './money.js';
import { LedgerDirection } from './wallet-ledger-entry.js';
import {
  SYSTEM_PROVIDER_ID,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type CreateOpeningTransactionProps,
  type CreateWagerTransactionProps,
} from './wager-transaction.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const now = new Date('2026-01-01T00:00:00.000Z');
const later = new Date('2026-01-01T00:00:05.000Z');

const baseProps: CreateWagerTransactionProps = {
  id: 'tx-1',
  providerId: 'provider-a',
  externalTransactionId: 'ext-1',
  idempotencyKey: 'provider-a:ext-1',
  payloadHash: 'hash-1',
  walletId: 'wallet-1',
  playerId: 'player-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.Bet,
  money: brl('25.00'),
  createdAt: now,
};

type Overrides = Partial<CreateWagerTransactionProps>;

const make = (overrides: Overrides = {}) =>
  WagerTransaction.create({ ...baseProps, ...overrides });

const makeWin = (overrides: Overrides = {}) =>
  make({ kind: WagerTransactionKind.Win, externalTransactionId: 'ext-w', ...overrides });

const makeRefund = (overrides: Overrides = {}) =>
  make({
    kind: WagerTransactionKind.Refund,
    externalTransactionId: 'ext-2',
    referenceExternalTransactionId: 'ext-1',
    ...overrides,
  });

const makeRollback = (overrides: Overrides = {}) =>
  make({
    kind: WagerTransactionKind.Rollback,
    externalTransactionId: 'ext-3',
    referenceExternalTransactionId: 'ext-1',
    ...overrides,
  });

const ofKind = (kind: WagerTransactionKind) =>
  make({
    kind,
    referenceExternalTransactionId:
      kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback
        ? 'ext-0'
        : undefined,
  });

const openingProps: CreateOpeningTransactionProps = {
  id: 'tx-open-1',
  walletId: 'wallet-1',
  playerId: 'player-1',
  money: brl('100.00'),
  createdAt: now,
};

type OpeningOverrides = Partial<CreateOpeningTransactionProps>;

const makeOpening = (overrides: OpeningOverrides = {}) =>
  WagerTransaction.createOpening({ ...openingProps, ...overrides });

describe('WagerTransaction.create', () => {
  it('nasce PENDING, sem falha e sem data de processamento', () => {
    const tx = make();
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.failureCode).toBeUndefined();
    expect(tx.processedAt).toBeUndefined();
    expect(tx.referenceTransactionId).toBeUndefined();
    expect(tx.isTerminal()).toBe(false);
  });

  it('rejeita OPENING, que é interno', () => {
    expect(() => make({ kind: WagerTransactionKind.Opening })).toThrow(
      InvalidWagerTransactionError,
    );
  });

  it('rejeita o provedor reservado system', () => {
    expect(() => make({ providerId: SYSTEM_PROVIDER_ID })).toThrow(InvalidWagerTransactionError);
    expect(() => make({ providerId: ` ${SYSTEM_PROVIDER_ID} ` })).toThrow(
      InvalidWagerTransactionError,
    );
  });

  it('rejeita kind desconhecido', () => {
    expect(() => make({ kind: 'BONUS' as WagerTransactionKind })).toThrow(
      InvalidWagerTransactionError,
    );
  });

  const textFields = [
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

  it.each(textFields)('rejeita %s vazio', (field) => {
    expect(() => make({ [field]: '  ' } as Overrides)).toThrow(InvalidWagerTransactionError);
  });

  it('rejeita BET com referência', () => {
    expect(() => make({ referenceExternalTransactionId: 'ext-0' })).toThrow(
      InvalidWagerTransactionError,
    );
  });

  it('rejeita REFUND sem referência', () => {
    expect(() =>
      make({ kind: WagerTransactionKind.Refund, externalTransactionId: 'ext-2' }),
    ).toThrow(InvalidWagerTransactionError);
  });

  it('rejeita ROLLBACK sem referência', () => {
    expect(() =>
      make({ kind: WagerTransactionKind.Rollback, externalTransactionId: 'ext-3' }),
    ).toThrow(InvalidWagerTransactionError);
  });

  it('rejeita referência em branco', () => {
    expect(() => makeRefund({ referenceExternalTransactionId: ' ' })).toThrow(
      InvalidWagerTransactionError,
    );
  });

  it('WIN aceita com e sem referência', () => {
    expect(makeWin().referenceExternalTransactionId).toBeUndefined();
    expect(makeWin({ referenceExternalTransactionId: 'ext-1' }).referenceExternalTransactionId).toBe(
      'ext-1',
    );
  });

  const zeroCases: [string, Overrides][] = [
    ['BET', { kind: WagerTransactionKind.Bet }],
    ['WIN', { kind: WagerTransactionKind.Win }],
    ['REFUND', { kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'ext-0' }],
  ];

  it.each(zeroCases)('rejeita valor zero em %s', (_name, overrides) => {
    expect(() => make({ ...overrides, money: Money.zero('BRL') })).toThrow(
      InvalidWagerTransactionError,
    );
  });

  it('LOSS aceita valor zero', () => {
    expect(() => make({ kind: WagerTransactionKind.Loss, money: Money.zero('BRL') })).not.toThrow();
  });

  it('rejeita valor negativo', () => {
    expect(() => make({ money: brl('1.00').subtract(brl('2.00')) })).toThrow(
      InvalidWagerTransactionError,
    );
  });
});

describe('WagerTransaction.createOpening', () => {
  it('nasce PROCESSED com os valores reservados da abertura', () => {
    const tx = makeOpening();
    expect(tx.kind).toBe(WagerTransactionKind.Opening);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.providerId).toBe(SYSTEM_PROVIDER_ID);
    expect(tx.externalTransactionId).toBe('opening:wallet-1');
    expect(tx.idempotencyKey).toBe('opening:wallet-1');
    expect(tx.payloadHash).toBe('opening');
    expect(tx.roundId).toBe('opening');
    expect(tx.gameId).toBe('opening');
    expect(tx.walletId).toBe('wallet-1');
    expect(tx.playerId).toBe('player-1');
    expect(tx.money.equals(brl('100.00'))).toBe(true);
    expect(tx.referenceExternalTransactionId).toBeUndefined();
    expect(tx.referenceTransactionId).toBeUndefined();
    expect(tx.failureCode).toBeUndefined();
    expect(tx.createdAt).toEqual(now);
    expect(tx.processedAt).toEqual(now);
    expect(tx.isTerminal()).toBe(true);
  });

  it('as chaves dependem só da wallet: iguais para a mesma, diferentes entre wallets', () => {
    const first = makeOpening({ id: 'tx-open-a' });
    const sameWallet = makeOpening({ id: 'tx-open-b' });
    const otherWallet = makeOpening({ id: 'tx-open-c', walletId: 'wallet-2' });

    expect(sameWallet.externalTransactionId).toBe(first.externalTransactionId);
    expect(sameWallet.idempotencyKey).toBe(first.idempotencyKey);
    expect(otherWallet.externalTransactionId).not.toBe(first.externalTransactionId);
    expect(otherWallet.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('credita, afeta o saldo e não pede referência', () => {
    const tx = makeOpening();
    expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    expect(tx.affectsBalance()).toBe(true);
    expect(tx.requiresReference()).toBe(false);
  });

  it('rejeita valor zero', () => {
    expect(() => makeOpening({ money: Money.zero('BRL') })).toThrow(InvalidWagerTransactionError);
  });

  const openingTextFields = ['id', 'walletId', 'playerId'] as const;

  it.each(openingTextFields)('rejeita %s vazio', (field) => {
    expect(() => makeOpening({ [field]: '  ' } as OpeningOverrides)).toThrow(
      InvalidWagerTransactionError,
    );
  });

  it('é terminal e não aceita nenhuma transição', () => {
    const tx = makeOpening();
    expect(() => tx.markProcessed(undefined, later)).toThrow(InvalidTransactionStateError);
    expect(() => tx.reject(FailureCode.ProcessingFailed)).toThrow(InvalidTransactionStateError);
    expect(() => tx.fail(FailureCode.ProcessingFailed)).toThrow(InvalidTransactionStateError);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
  });
});

describe('WagerTransaction consultas', () => {
  const kinds = [
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Loss,
    WagerTransactionKind.Refund,
    WagerTransactionKind.Rollback,
  ];

  it('affectsBalance é falso só para LOSS', () => {
    for (const kind of kinds) {
      expect(ofKind(kind).affectsBalance()).toBe(kind !== WagerTransactionKind.Loss);
    }
  });

  it('requiresReference é verdadeiro só para REFUND e ROLLBACK', () => {
    for (const kind of kinds) {
      const expected =
        kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback;
      expect(ofKind(kind).requiresReference()).toBe(expected);
    }
  });

  it('matchesPayload compara o hash', () => {
    const tx = make();
    expect(tx.matchesPayload('hash-1')).toBe(true);
    expect(tx.matchesPayload('hash-2')).toBe(false);
  });
});

describe('WagerTransaction transições', () => {
  it('PENDING vai para PROCESSED e guarda a data', () => {
    const tx = make();
    tx.markProcessed(undefined, later);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.processedAt).toEqual(later);
    expect(tx.isTerminal()).toBe(true);
  });

  it('PENDING vai para PENDING_REFERENCE e depois para PROCESSED com a referência interna', () => {
    const tx = makeRefund();
    tx.markPendingReference();
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
    expect(tx.isTerminal()).toBe(false);

    tx.markProcessed('tx-0', later);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.referenceTransactionId).toBe('tx-0');
  });

  it('PENDING_REFERENCE pode continuar esperando', () => {
    const tx = makeRefund();
    tx.markPendingReference();
    tx.markPendingReference();
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
  });

  it('não espera referência quem não declarou uma', () => {
    expect(() => make().markPendingReference()).toThrow(InvalidTransactionStateError);
  });

  it('REFUND não é processado sem o id interno da referência', () => {
    const tx = makeRefund();
    expect(() => tx.markProcessed(undefined, later)).toThrow(InvalidTransactionStateError);
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
  });

  it('PENDING_REFERENCE vai para REJECTED guardando o código', () => {
    const tx = makeRefund();
    tx.markPendingReference();
    tx.reject(FailureCode.ReferenceNotFound);
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe(FailureCode.ReferenceNotFound);
  });

  it('PENDING vai para FAILED guardando o código', () => {
    const tx = make();
    tx.fail(FailureCode.ProcessingFailed);
    expect(tx.status).toBe(WagerTransactionStatus.Failed);
    expect(tx.failureCode).toBe(FailureCode.ProcessingFailed);
  });

  const winWithReference = () => makeWin({ referenceExternalTransactionId: 'ext-1' });

  const terminals: [string, () => WagerTransaction][] = [
    [
      'PROCESSED',
      () => {
        const tx = winWithReference();
        tx.markProcessed(undefined, now);
        return tx;
      },
    ],
    [
      'REJECTED',
      () => {
        const tx = winWithReference();
        tx.reject(FailureCode.ReferenceNotProcessed);
        return tx;
      },
    ],
    [
      'FAILED',
      () => {
        const tx = winWithReference();
        tx.fail(FailureCode.ProcessingFailed);
        return tx;
      },
    ],
  ];

  it.each(terminals)('%s é terminal e não aceita nenhuma transição', (_name, build) => {
    const tx = build();
    const status = tx.status;
    const failureCode = tx.failureCode;

    expect(tx.isTerminal()).toBe(true);
    expect(() => tx.markProcessed(undefined, later)).toThrow(InvalidTransactionStateError);
    expect(() => tx.markPendingReference()).toThrow(InvalidTransactionStateError);
    expect(() => tx.reject(FailureCode.AmountMismatch)).toThrow(InvalidTransactionStateError);
    expect(() => tx.fail(FailureCode.ProcessingFailed)).toThrow(InvalidTransactionStateError);
    expect(tx.status).toBe(status);
    expect(tx.failureCode).toBe(failureCode);
  });
});

describe('WagerTransaction.ledgerDirectionFor', () => {
  it('BET debita, WIN e REFUND creditam', () => {
    expect(make().ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    expect(makeWin().ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    expect(makeRefund().ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  it('ROLLBACK inverte a direção da referência', () => {
    const rollback = makeRollback();
    expect(rollback.ledgerDirectionFor(make())).toBe(LedgerDirection.Credit);
    expect(rollback.ledgerDirectionFor(makeWin())).toBe(LedgerDirection.Debit);
    expect(rollback.ledgerDirectionFor(makeRefund())).toBe(LedgerDirection.Debit);
  });

  it('ROLLBACK sem referência lança erro', () => {
    expect(() => makeRollback().ledgerDirectionFor()).toThrow(InvalidWagerTransactionError);
  });

  it('ROLLBACK de ROLLBACK ou de LOSS lança erro', () => {
    const rollback = makeRollback();
    const loss = make({ kind: WagerTransactionKind.Loss, externalTransactionId: 'ext-l' });
    expect(() => rollback.ledgerDirectionFor(makeRollback())).toThrow(
      InvalidWagerTransactionError,
    );
    expect(() => rollback.ledgerDirectionFor(loss)).toThrow(InvalidWagerTransactionError);
  });

  it('LOSS não move saldo e não tem direção', () => {
    const loss = make({ kind: WagerTransactionKind.Loss });
    expect(() => loss.ledgerDirectionFor()).toThrow(InvalidWagerTransactionError);
  });
});

describe('WagerTransaction.validateReference', () => {
  it('REFUND de uma BET compatível é válido', () => {
    expect(makeRefund().validateReference(make())).toBeUndefined();
  });

  it('ROLLBACK de BET, WIN ou REFUND é válido', () => {
    expect(makeRollback().validateReference(make())).toBeUndefined();

    const win = makeWin();
    expect(makeRollback({ referenceExternalTransactionId: 'ext-w' }).validateReference(win)).toBe(
      undefined,
    );

    const refund = makeRefund({ externalTransactionId: 'ext-r' });
    expect(
      makeRollback({ referenceExternalTransactionId: 'ext-r' }).validateReference(refund),
    ).toBeUndefined();
  });

  it('REFUND de uma WIN é tipo de referência inválido', () => {
    const win = makeWin();
    const refund = makeRefund({ referenceExternalTransactionId: 'ext-w' });
    expect(refund.validateReference(win)).toBe(FailureCode.InvalidReferenceKind);
  });

  it('ROLLBACK de ROLLBACK é tipo de referência inválido', () => {
    const first = makeRollback({ externalTransactionId: 'ext-rb1' });
    const second = makeRollback({
      externalTransactionId: 'ext-rb2',
      referenceExternalTransactionId: 'ext-rb1',
    });
    expect(second.validateReference(first)).toBe(FailureCode.InvalidReferenceKind);
  });

  it('WIN de WIN é tipo de referência inválido', () => {
    const first = makeWin();
    const second = makeWin({
      externalTransactionId: 'ext-w2',
      referenceExternalTransactionId: 'ext-w',
    });
    expect(second.validateReference(first)).toBe(FailureCode.InvalidReferenceKind);
  });

  it('WIN pode ter valor diferente da BET que referencia', () => {
    const win = makeWin({ referenceExternalTransactionId: 'ext-1', money: brl('100.00') });
    expect(win.validateReference(make())).toBeUndefined();
  });

  const mismatches: [string, Overrides][] = [
    ['provedor', { providerId: 'provider-b' }],
    ['jogador', { playerId: 'player-2' }],
    ['wallet', { walletId: 'wallet-2' }],
    ['rodada', { roundId: 'round-2' }],
    ['moeda', { money: Money.from({ amount: '25.00', currency: 'USD' }) }],
  ];

  it.each(mismatches)('referência de outro %s é rejeitada', (_name, overrides) => {
    const reference = make(overrides);
    expect(makeRefund().validateReference(reference)).toBe(FailureCode.ReferenceMismatch);
  });

  it('referência com id externo diferente do declarado é rejeitada', () => {
    const reference = make({ externalTransactionId: 'ext-9' });
    expect(makeRefund().validateReference(reference)).toBe(FailureCode.ReferenceMismatch);
  });

  it('REFUND com valor diferente da referência é rejeitado', () => {
    const refund = makeRefund({ money: brl('10.00') });
    expect(refund.validateReference(make())).toBe(FailureCode.AmountMismatch);
  });
});

describe('WagerTransaction.rehydrate', () => {
  it('reconstrói o estado persistido sem revalidar', () => {
    const tx = WagerTransaction.rehydrate({
      id: 'tx-9',
      providerId: 'provider-a',
      externalTransactionId: 'ext-9',
      idempotencyKey: 'provider-a:ext-9',
      payloadHash: 'hash-9',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Refund,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: 'ext-1',
      createdAt: now,
      status: WagerTransactionStatus.Processed,
      referenceTransactionId: 'tx-1',
      processedAt: later,
    });

    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.referenceTransactionId).toBe('tx-1');
    expect(tx.processedAt).toEqual(later);
    expect(tx.money.equals(brl('25.00'))).toBe(true);
    expect(tx.isTerminal()).toBe(true);
  });
});