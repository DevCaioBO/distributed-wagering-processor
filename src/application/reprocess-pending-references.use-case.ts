import type { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransactionStatus } from '../domain/wager-transaction.js';
import type { WagerTransactionRow } from '../infra/database/rows.js';
import { WagerTransactionSchema } from '../infra/database/schemas.js';
import { toWagerTransaction } from '../infra/database/wager-transaction.mapper.js';
import {
  TransactionProcessor,
  type ProcessOutcome,
} from './transaction-processor.js';
import type { LoggerPort } from './ports/logger.port.js';
import type { MetricsPort } from './ports/metrics.port.js';
import type { WageringConfig } from './wagering-config.js';

export interface ReprocessPendingReferencesResult {
  reprocessed: ProcessOutcome[];
  claimed: number;
}

/**
 * Worker agendado da seção 7.1: reprocessa transações PENDING_REFERENCE com
 * retry vencido. `FOR UPDATE SKIP LOCKED` reparte o trabalho entre instâncias
 * concorrentes sem duplicar esforço; o lock da wallet (dentro do processador)
 * garante a ordem correta quando a referência chega junto.
 */
export class ReprocessPendingReferencesUseCase {
  private readonly processor: TransactionProcessor;

  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsPort,
    private readonly logger: LoggerPort,
    config: WageringConfig,
  ) {
    this.processor = new TransactionProcessor(em, metrics, logger, config);
  }

  async execute(limit: number, correlationId?: string): Promise<ReprocessPendingReferencesResult> {
    const claimed = await this.em.transactional(async (tem) => {
      const rows = await tem.execute<WagerTransactionRow[]>(
        `select id from wager_transactions
          where status = 'PENDING_REFERENCE'
            and next_attempt_at is not null and next_attempt_at <= now()
          order by next_attempt_at
          limit ${Math.max(1, Math.trunc(limit))}
          for update skip locked`,
        [],
        'all',
      );
      return rows.map((row) => row.id);
    });

    const reprocessed: ProcessOutcome[] = [];
    for (const id of claimed) {
      const outcome = await this.reprocessOne(id, correlationId);
      if (outcome !== null) {
        reprocessed.push(outcome);
      }
    }
    return { reprocessed, claimed: claimed.length };
  }

  private async reprocessOne(id: string, correlationId?: string): Promise<ProcessOutcome | null> {
    return this.em.transactional(async (tem) => {
      const row = (await tem.findOne(WagerTransactionSchema, {
        id,
      })) as WagerTransactionRow | null;
      if (row === null || row.status !== WagerTransactionStatus.PendingReference) {
        return null;
      }
      const transaction = toWagerTransaction(row);
      const outcome = await this.processor.process(transaction, {
        now: new Date(),
        correlationId: correlationId ?? `reference-retry:${id}`,
        source: 'WORKER',
        referenceAttempts: row.referenceAttempts,
      });
      this.metrics.countTransaction(outcome.status, transaction.kind, 'WORKER');
      return outcome;
    });
  }
}
