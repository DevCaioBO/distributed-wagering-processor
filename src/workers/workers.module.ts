import { Module } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SubmitWagerTransactionUseCase } from '../application/submit-wager-transaction.use-case.js';
import { ReprocessPendingReferencesUseCase } from '../application/reprocess-pending-references.use-case.js';
import { wageringConfigFromEnv } from '../application/wagering-config.js';
import { JsonLogger } from '../infra/observability/json-logger.js';
import { defaultMetrics } from '../infra/observability/metrics.js';
import { OutboxPublisherWorker } from '../infra/messaging/outbox-publisher.worker.js';
import { SqsConsumerWorker } from '../infra/messaging/sqs-consumer.worker.js';
import { SqsGateway } from '../infra/messaging/sqs-gateway.js';
import { sqsConfigFromEnv, type SqsConfig } from '../infra/messaging/sqs-config.js';
import { OutboxPublisherService } from './outbox-publisher.service.js';
import { ReferenceRetryService } from './reference-retry.service.js';
import { SqsConsumerService } from './sqs-consumer.service.js';
import {
  OUTBOX_WORKER,
  REFERENCE_RETRY_BATCH_SIZE,
  REFERENCE_RETRY_INTERVAL_MS,
  REFERENCE_RETRY_USE_CASE,
  SQS_CONFIG,
  SQS_CONSUMER_WORKER,
  SQS_GATEWAY,
  SUBMIT_USE_CASE,
} from './workers.tokens.js';

function intFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Workers de background: publisher da outbox, retry de referências
 * fora de ordem (seção 7.1) e consumidor da fila de transações (seção 10).
 *
 * Todos iniciam no bootstrap do Nest e param de forma graciosa no shutdown
 * (SIGTERM): a ordem importa — o consumer para de receber antes de o
 * processo finalizar, e mensagens não concluídas voltam para a fila.
 *
 * `WORKERS_ENABLED=false` desliga tudo (usado nos testes HTTP para isolar o
 * caminho síncrono); o gateway continua exportado para o /health/ready.
 */
const workersEnabled = process.env.WORKERS_ENABLED !== 'false';

@Module({
  providers: [
    { provide: SQS_CONFIG, useFactory: (): SqsConfig => sqsConfigFromEnv() },
    {
      provide: REFERENCE_RETRY_INTERVAL_MS,
      useFactory: (): number => intFromEnv('REFERENCE_RETRY_INTERVAL_MS', 1000),
    },
    {
      provide: REFERENCE_RETRY_BATCH_SIZE,
      useFactory: (): number => intFromEnv('REFERENCE_RETRY_BATCH_SIZE', 10),
    },
    {
      provide: SQS_GATEWAY,
      useFactory: (config: SqsConfig): SqsGateway =>
        new SqsGateway(config.endpoint, config.region),
      inject: [SQS_CONFIG],
    },
    {
      provide: SUBMIT_USE_CASE,
      useFactory: (em: EntityManager): SubmitWagerTransactionUseCase =>
        new SubmitWagerTransactionUseCase(em, defaultMetrics, new JsonLogger(), wageringConfigFromEnv()),
      inject: [EntityManager],
    },
    {
      provide: REFERENCE_RETRY_USE_CASE,
      useFactory: (em: EntityManager): ReprocessPendingReferencesUseCase =>
        new ReprocessPendingReferencesUseCase(em, defaultMetrics, new JsonLogger(), wageringConfigFromEnv()),
      inject: [EntityManager],
    },
    {
      provide: OUTBOX_WORKER,
      useFactory: (em: EntityManager, gateway: SqsGateway, config: SqsConfig): OutboxPublisherWorker =>
        new OutboxPublisherWorker(em, gateway, defaultMetrics, new JsonLogger(), {
          eventsQueueUrl: config.eventsQueueUrl,
          pollIntervalMs: intFromEnv('OUTBOX_POLL_INTERVAL_MS', 500),
          batchSize: intFromEnv('OUTBOX_BATCH_SIZE', 50),
        }),
      inject: [EntityManager, SQS_GATEWAY, SQS_CONFIG],
    },
    {
      provide: SQS_CONSUMER_WORKER,
      useFactory: (
        em: EntityManager,
        gateway: SqsGateway,
        submit: SubmitWagerTransactionUseCase,
        config: SqsConfig,
      ): SqsConsumerWorker =>
        new SqsConsumerWorker(em, gateway, submit, defaultMetrics, new JsonLogger(), {
          transactionsQueueUrl: config.transactionsQueueUrl,
          transactionsDlqUrl: config.transactionsDlqUrl,
          consumerName: process.env.SQS_CONSUMER_NAME ?? 'wager-transactions',
          maxMessages: intFromEnv('SQS_CONSUMER_MAX_MESSAGES', 10),
          waitSeconds: intFromEnv('SQS_CONSUMER_WAIT_SECONDS', 10),
          visibilityTimeoutSeconds: intFromEnv('SQS_CONSUMER_VISIBILITY_TIMEOUT_SECONDS', 60),
          retryBaseSeconds: intFromEnv('SQS_CONSUMER_RETRY_BASE_SECONDS', 5),
          maxAttempts: intFromEnv('SQS_CONSUMER_MAX_ATTEMPTS', 5),
        }),
      inject: [EntityManager, SQS_GATEWAY, SUBMIT_USE_CASE, SQS_CONFIG],
    },
    ...(workersEnabled
      ? [OutboxPublisherService, ReferenceRetryService, SqsConsumerService]
      : []),
  ],
  exports: [SQS_GATEWAY, SQS_CONFIG],
})
export class WorkersModule {}
