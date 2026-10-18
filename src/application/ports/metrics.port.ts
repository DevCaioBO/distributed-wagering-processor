import type { FailureCode } from '../../domain/failure-code.js';
import type {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction.js';

/**
 * Porta de métricas usada pela camada de aplicação. A implementação fica na
 * infraestrutura; o domínio e a aplicação só conhecem esta interface.
 */
export interface MetricsPort {
  countTransaction(
    status: WagerTransactionStatus,
    kind: WagerTransactionKind,
    source: string,
  ): void;
  countDuplicate(scope: 'inbox' | 'idempotency'): void;
  countIdempotencyConflict(): void;
  countRejection(code: FailureCode): void;
  countReferenceRetry(exhausted: boolean): void;
  countMessageRetry(): void;
  countDlq(reason: string): void;
  countLockConflict(): void;
  observeWalletLockWait(ms: number): void;
  observeProcessingDuration(source: string, ms: number): void;
  countOutboxPublish(outcome: 'success' | 'failure'): void;
  setOutboxState(pending: number, lagSeconds: number): void;
  countReconciliation(consistent: boolean): void;
}
