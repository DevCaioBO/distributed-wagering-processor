import type { EntityManager } from '@mikro-orm/postgresql';
import { SubmitWagerTransactionUseCase } from '../../src/application/submit-wager-transaction.use-case.js';
import { ReprocessPendingReferencesUseCase } from '../../src/application/reprocess-pending-references.use-case.js';
import { ReconcileWalletUseCase } from '../../src/application/reconcile-wallet.use-case.js';
import { CreateWalletUseCase } from '../../src/application/create-wallet.use-case.js';
import { GetWagerTransactionUseCase } from '../../src/application/get-wager-transaction.use-case.js';
import { wageringConfigFromEnv, type WageringConfig } from '../../src/application/wagering-config.js';
import { JsonLogger } from '../../src/infra/observability/json-logger.js';
import { PrometheusMetrics } from '../../src/infra/observability/metrics.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';

/** Logger silencioso: os testes não precisam da saída estruturada no stdout. */
export function silentLogger(): LoggerPort {
  return new JsonLogger({ minLevel: 'error', sink: () => {} });
}

/** Métricas isoladas por teste — não compartilham contadores com o processo. */
export function testMetrics(): PrometheusMetrics {
  return new PrometheusMetrics();
}

export function testConfig(overrides: Partial<WageringConfig> = {}): WageringConfig {
  return { ...wageringConfigFromEnv(), ...overrides };
}

export function makeSubmit(
  em: EntityManager,
  config: WageringConfig = testConfig(),
): SubmitWagerTransactionUseCase {
  return new SubmitWagerTransactionUseCase(em, testMetrics(), silentLogger(), config);
}

export function makeReprocess(
  em: EntityManager,
  config: WageringConfig = testConfig(),
): ReprocessPendingReferencesUseCase {
  return new ReprocessPendingReferencesUseCase(em, testMetrics(), silentLogger(), config);
}

export function makeReconcile(em: EntityManager): ReconcileWalletUseCase {
  return new ReconcileWalletUseCase(em, testMetrics(), silentLogger());
}

export function makeCreateWallet(em: EntityManager): CreateWalletUseCase {
  return new CreateWalletUseCase(em, silentLogger());
}

export function makeGetTransaction(em: EntityManager): GetWagerTransactionUseCase {
  return new GetWagerTransactionUseCase(em);
}

export interface PayloadOptions {
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  kind?: 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
  amount?: string;
  currency?: string;
  roundId?: string;
  gameId?: string;
  referenceExternalTransactionId?: string;
}

/** Payload no mesmo shape aceito pelo HTTP (a fila transporta o mesmo objeto). */
export function payload(options: PayloadOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    providerId: options.providerId,
    externalTransactionId: options.externalTransactionId,
    playerId: options.playerId,
    walletId: options.walletId,
    roundId: options.roundId ?? 'round-test',
    gameId: options.gameId ?? 'game-test',
    kind: options.kind ?? 'BET',
    money: { amount: options.amount ?? '10.00', currency: options.currency ?? 'BRL' },
  };
  if (options.referenceExternalTransactionId !== undefined) {
    body.referenceExternalTransactionId = options.referenceExternalTransactionId;
  }
  return body;
}
