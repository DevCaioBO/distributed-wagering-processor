import type { EntityManager } from '@mikro-orm/postgresql';
import type { Message } from '@aws-sdk/client-sqs';
import {
  IdempotencyConflictError,
  PayloadValidationError,
} from '../../application/errors.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { MetricsPort } from '../../application/ports/metrics.port.js';
import type {
  SubmitWagerTransactionUseCase,
  SubmitWagerTransactionResult,
} from '../../application/submit-wager-transaction.use-case.js';
import type { SqsGatewayPort } from './sqs-gateway.js';

export interface SqsConsumerConfig {
  transactionsQueueUrl: string;
  transactionsDlqUrl: string;
  /** Nome do consumidor: metade da chave da inbox (consumer_name, message_id). */
  consumerName: string;
  maxMessages: number;
  waitSeconds: number;
  visibilityTimeoutSeconds: number;
  /** Backoff base (segundos) para falhas transitórias: base * 2^(tentativa-1). */
  retryBaseSeconds: number;
  /** Tentativas de processamento antes de mover a mensagem à DLQ. */
  maxAttempts: number;
}

/** Envelope da seção 10: { messageId, type, occurredAt, data }. */
interface WagerTransactionEnvelope {
  messageId?: unknown;
  type?: unknown;
  occurredAt?: unknown;
  data?: unknown;
}

export type MessageOutcome =
  | 'processed'
  | 'duplicate'
  | 'rejected'
  | 'dlq'
  | 'retry'
  | 'parse_error';

/**
 * Consumidor da fila FIFO de transações (seção 10). Reutiliza o MESMO caso de
 * uso do caminho HTTP — as regras de idempotência e concorrência são uma só.
 *
 * - dedup persistente na inbox por (consumerName, SQS messageId): redelivery
 *   após crash devolve o resultado original sem novo efeito financeiro;
 * - ack (delete) somente DEPOIS do commit do caso de uso;
 * - erros de negócio (rejeição) são terminais: persistidos e confirmados;
 * - payload inválido/conflitante é permanente: vai para a DLQ explicitamente;
 * - falhas transitórias devolvem a visibilidade com backoff; esgotadas as
 *   tentativas, a mensagem vai para a DLQ.
 */
export class SqsConsumerWorker {
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly em: EntityManager,
    private readonly gateway: SqsGatewayPort,
    private readonly submit: SubmitWagerTransactionUseCase,
    private readonly metrics: MetricsPort,
    private readonly logger: LoggerPort,
    private readonly config: SqsConsumerConfig,
  ) {}

  /** Loop de long polling. Retornar é imediato; `stop()` encerra o ciclo. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.inFlight = this.pollLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.inFlight;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.gateway.receive(this.config.transactionsQueueUrl, {
          maxMessages: this.config.maxMessages,
          waitSeconds: this.config.waitSeconds,
          visibilityTimeoutSeconds: this.config.visibilityTimeoutSeconds,
        });
        for (const message of messages) {
          if (!this.running) {
            // Shutdown no meio do lote: devolve visibilidade para outra instância.
            if (message.ReceiptHandle !== undefined) {
              await this.safeChangeVisibility(message.ReceiptHandle, 0);
            }
            break;
          }
          await this.processOne(message);
        }
      } catch (error) {
        this.logger.error('sqs_poll_failed', { error });
        await Bun.sleep(1000);
      }
    }
  }

  /** Processa uma mensagem isoladamente — exposto para os testes de integração. */
  async processOne(message: Message): Promise<MessageOutcome> {
    const messageId = message.MessageId ?? 'unknown';

    let envelope: WagerTransactionEnvelope;
    try {
      const parsed: unknown = JSON.parse(message.Body ?? '');
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('envelope não é um objeto');
      }
      envelope = parsed as WagerTransactionEnvelope;
    } catch (error) {
      this.logger.warn('sqs_message_unparseable', { messageId, error });
      return this.moveToDlq(message, 'unparseable', message.Body ?? '');
    }

    if (typeof envelope.data !== 'object' || envelope.data === null) {
      this.logger.warn('sqs_message_without_data', { messageId });
      return this.moveToDlq(message, 'missing_data', message.Body ?? '');
    }

    const payload = envelope.data as Record<string, unknown>;
    const providerId = typeof payload.providerId === 'string' ? payload.providerId : '';
    const externalId =
      typeof payload.externalTransactionId === 'string' ? payload.externalTransactionId : '';
    const idempotencyKey =
      typeof payload.idempotencyKey === 'string' && payload.idempotencyKey.trim() !== ''
        ? payload.idempotencyKey.trim()
        : `${providerId}:${externalId}`;

    try {
      const result: SubmitWagerTransactionResult = await this.submit.execute({
        idempotencyKey,
        correlationId: `sqs:${messageId}`,
        source: 'SQS',
        inbox: { consumerName: this.config.consumerName, messageId },
        payload,
      });
      // Commit já aconteceu: ack é seguro. Rejeição de negócio também é terminal.
      await this.ack(message);
      this.logger.info('sqs_message_processed', {
        messageId,
        transactionId: result.transactionId,
        status: result.status,
        replay: result.idempotentReplay,
      });
      return result.idempotentReplay ? 'duplicate' : 'processed';
    } catch (error) {
      if (
        error instanceof PayloadValidationError ||
        error instanceof IdempotencyConflictError
      ) {
        // Permanente: nunca terá sucesso — envia para a DLQ e confirma.
        return this.moveToDlq(
          message,
          error instanceof PayloadValidationError ? 'invalid_payload' : 'idempotency_conflict',
          message.Body ?? '',
        );
      }
      return this.scheduleRetryOrFail(message, error);
    }
  }

  private async scheduleRetryOrFail(message: Message, error: unknown): Promise<MessageOutcome> {
    const receiveCount = Number.parseInt(
      message.Attributes?.ApproximateReceiveCount ?? '1',
      10,
    );
    if (receiveCount >= this.config.maxAttempts) {
      this.logger.error('sqs_message_exhausted', { messageId: message.MessageId, receiveCount, error });
      return this.moveToDlq(message, 'processing_error', message.Body ?? '');
    }
    const backoffSeconds = Math.min(
      this.config.retryBaseSeconds * 2 ** (Math.max(1, receiveCount) - 1),
      300,
    );
    this.metrics.countMessageRetry();
    this.logger.warn('sqs_message_retry', {
      messageId: message.MessageId,
      receiveCount,
      backoffSeconds,
      error,
    });
    if (message.ReceiptHandle !== undefined) {
      await this.safeChangeVisibility(message.ReceiptHandle, backoffSeconds);
    }
    return 'retry';
  }

  private async moveToDlq(message: Message, reason: string, body: string): Promise<MessageOutcome> {
    const original = JSON.parse(body) as { data?: { providerId?: unknown } } | null;
    const groupId =
      typeof original?.data?.providerId === 'string' ? original.data.providerId : 'unknown';
    await this.gateway.send(this.config.transactionsDlqUrl, body, {
      // dedupId estável: crash entre enviar e apagar não duplica na DLQ.
      dedupId: message.MessageId ?? body.slice(0, 80),
      groupId,
    });
    await this.ack(message);
    this.metrics.countDlq(reason);
    this.logger.warn('sqs_message_moved_to_dlq', { messageId: message.MessageId, reason });
    return 'dlq';
  }

  private async ack(message: Message): Promise<void> {
    if (message.ReceiptHandle !== undefined) {
      await this.gateway.delete(this.config.transactionsQueueUrl, message.ReceiptHandle);
    }
  }

  private async safeChangeVisibility(receiptHandle: string, seconds: number): Promise<void> {
    try {
      await this.gateway.changeVisibility(
        this.config.transactionsQueueUrl,
        receiptHandle,
        seconds,
      );
    } catch (error) {
      this.logger.error('sqs_change_visibility_failed', { error });
    }
  }
}
