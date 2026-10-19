import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { ReprocessPendingReferencesUseCase } from '../application/reprocess-pending-references.use-case.js';
import {
  REFERENCE_RETRY_BATCH_SIZE,
  REFERENCE_RETRY_INTERVAL_MS,
  REFERENCE_RETRY_USE_CASE,
} from './workers.tokens.js';

/**
 * Worker agendado da seção 7.1: varre transações PENDING_REFERENCE com retry
 * vencido a cada intervalo. Instâncias concorrentes se repartem via
 * `FOR UPDATE SKIP LOCKED` dentro do caso de uso.
 */
@Injectable()
export class ReferenceRetryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReferenceRetryService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    @Inject(REFERENCE_RETRY_USE_CASE)
    private readonly useCase: ReprocessPendingReferencesUseCase,
    @Inject(REFERENCE_RETRY_INTERVAL_MS) private readonly intervalMs: number,
    @Inject(REFERENCE_RETRY_BATCH_SIZE) private readonly batchSize: number,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.inFlight = this.inFlight.then(async () => {
        try {
          const result = await this.useCase.execute(this.batchSize);
          if (result.claimed > 0) {
            this.logger.log(
              `reference retry: ${result.reprocessed.length}/${result.claimed} reprocessadas`,
            );
          }
        } catch (error) {
          this.logger.error('reference retry failed', error instanceof Error ? error.stack : '');
        }
      });
    }, this.intervalMs);
    // O loop não deve segurar o processo de pé sozinho.
    this.timer.unref?.();
    this.logger.log(`reference retry worker started (interval ${this.intervalMs}ms)`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
    this.logger.log('reference retry worker stopped');
  }
}
