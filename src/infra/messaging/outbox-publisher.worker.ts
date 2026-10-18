import type { EntityManager } from '@mikro-orm/postgresql';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { MetricsPort } from '../../application/ports/metrics.port.js';
import { referenceBackoffMs } from '../../application/wagering-config.js';
import type { OutboxMessageRow } from '../database/rows.js';
import { OutboxMessageSchema } from '../database/schemas.js';
import { toOutboxMessage } from '../database/outbox-message.mapper.js';
import type { SqsGateway } from './sqs-gateway.js';

export interface OutboxPublisherConfig {
  eventsQueueUrl: string;
  /** Intervalo entre lotes. */
  pollIntervalMs: number;
  /** Tamanho máximo de lote. */
  batchSize: number;
}

/**
 * Worker da outbox: publica na fila de eventos os registros já commitados,
 * respeitando o próximo horário de tentativa.
 *
 * - `FOR UPDATE SKIP LOCKED` permite N instâncias concorrentes sem duplicar
 *   nem bloquear: cada linha é levantada por uma única instância por vez;
 * - a publicação acontece DENTRO da transação que segura o lock da linha — se
 *   o processo cair no meio, a linha volta a ficar pendente e o dedupId da
 *   FIFO (id da outbox) absorve a republicação;
 * - falha de envio agenda retry com backoff exponencial e interrompe o lote
 *   (a ordem por `occurred_at` é preservada).
 */
export class OutboxPublisherWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly em: EntityManager,
    private readonly gateway: SqsGateway,
    private readonly metrics: MetricsPort,
    private readonly logger: LoggerPort,
    private readonly config: OutboxPublisherConfig,
  ) {}

  /** Publica um lote de mensagens vencidas. Retorna quantas saíram. */
  async publishDueBatch(now: Date = new Date()): Promise<number> {
    const published = await this.em.transactional(async (tem) => {
      // A transação mantém o lock das linhas enquanto o lote é enviado: outra
      // instância não pega as mesmas mensagens, e um crash no meio devolve as
      // linhas ao estado pendente (rollback) para nova tentativa.
      const rows = await tem.execute<OutboxMessageRow[]>(
        `select * from outbox_messages
          where published_at is null
            and (next_attempt_at is null or next_attempt_at <= ?)
          order by occurred_at
          limit ?
          for update skip locked`,
        [now.toISOString(), this.config.batchSize],
        'all',
      );

      let count = 0;
      for (const row of rows) {
        const message = toOutboxMessage(row);
        try {
          await this.gateway.send(this.config.eventsQueueUrl, JSON.stringify(message.payload), {
            // dedupId estável: republicação após crash é absorvida pela FIFO.
            dedupId: message.id,
            groupId: message.aggregateId,
          });
        } catch (error) {
          this.metrics.countOutboxPublish('failure');
          this.logger.error('outbox_publish_failed', {
            outboxId: message.id,
            eventType: message.eventType,
            error,
          });
          await this.scheduleRetry(tem, message.id, now);
          this.metrics.countMessageRetry();
          break; // preserva a ordem: para o lote na primeira falha
        }

        await tem.nativeUpdate(
          OutboxMessageSchema,
          { id: message.id },
          { publishedAt: now, nextAttemptAt: null },
        );
        this.metrics.countOutboxPublish('success');
        count += 1;
      }
      return count;
    });

    await this.refreshOutboxState();
    return published;
  }

  /** Inicia o loop periódico. Seguro chamar mais de uma vez. */
  start(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      this.inFlight = this.inFlight.then(async () => {
        try {
          await this.publishDueBatch();
        } catch (error) {
          this.logger.error('outbox_publisher_batch_failed', { error });
        }
      });
    }, this.config.pollIntervalMs);
    // O loop é periódico e não deve segurar o processo de pé sozinho.
    this.timer.unref?.();
  }

  /** Para o loop e espera o lote em andamento terminar. */
  async stop(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }

  private async scheduleRetry(
    tem: EntityManager,
    outboxId: string,
    now: Date,
  ): Promise<void> {
    const row = (await tem.findOne(OutboxMessageSchema, { id: outboxId })) as
      | OutboxMessageRow
      | null;
    if (row === null) {
      return;
    }
    const message = toOutboxMessage(row);
    message.scheduleRetry(now);
    await tem.nativeUpdate(
      OutboxMessageSchema,
      { id: outboxId },
      {
        attempts: message.attempts,
        nextAttemptAt: message.nextAttemptAt ?? null,
      },
    );
  }

  /** Gauge de saúde: quantas mensagens esperam e há quanto tempo a mais antiga. */
  private async refreshOutboxState(): Promise<void> {
    const rows = await this.em.execute<{ pending: string; oldest: string | null }[]>(
      `select count(*)::text as pending,
              extract(epoch from (now() - min(occurred_at)))::text as oldest
         from outbox_messages where published_at is null`,
      [],
      'all',
    );
    const summary = rows[0] ?? { pending: '0', oldest: null };
    const lagSeconds =
      summary.oldest === null ? 0 : Number.parseFloat(summary.oldest);
    this.metrics.setOutboxState(
      Number.parseInt(summary.pending, 10),
      Number.isFinite(lagSeconds) ? lagSeconds : 0,
    );
  }
}

/** Backoff usado pelo publisher é o mesmo do domínio (1s..60s exponencial). */
export const outboxBackoffMs = referenceBackoffMs;
