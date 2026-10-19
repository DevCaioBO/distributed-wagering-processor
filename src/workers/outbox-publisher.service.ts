import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { OutboxPublisherWorker } from '../infra/messaging/outbox-publisher.worker.js';
import { OUTBOX_WORKER } from './workers.tokens.js';

/**
 * Lifecycle do publisher da outbox: inicia no bootstrap e para de forma
 * graciosa no shutdown (espera o lote em andamento terminar).
 */
@Injectable()
export class OutboxPublisherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisherService.name);

  constructor(@Inject(OUTBOX_WORKER) private readonly worker: OutboxPublisherWorker) {}

  onApplicationBootstrap(): void {
    this.worker.start();
    this.logger.log('outbox publisher started');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.stop();
    this.logger.log('outbox publisher stopped');
  }
}
