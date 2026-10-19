import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { SqsConsumerWorker } from '../infra/messaging/sqs-consumer.worker.js';
import { SQS_CONSUMER_WORKER } from './workers.tokens.js';

/**
 * Lifecycle do consumidor da fila de transações (seção 10): inicia no
 * bootstrap e encerra de forma graciosa — para de receber, devolve a
 * visibilidade das mensagens não processadas e espera as em andamento.
 */
@Injectable()
export class SqsConsumerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SqsConsumerService.name);

  constructor(@Inject(SQS_CONSUMER_WORKER) private readonly worker: SqsConsumerWorker) {}

  onApplicationBootstrap(): void {
    this.worker.start();
    this.logger.log('sqs transactions consumer started');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.stop();
    this.logger.log('sqs transactions consumer stopped');
  }
}
