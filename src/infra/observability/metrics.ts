import type { MetricsPort } from '../../application/ports/metrics.port.js';
import type { FailureCode } from '../../domain/failure-code.js';
import type {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction.js';

type Labels = Record<string, string>;

function labelKey(labelNames: readonly string[], labels: Labels): string {
  return labelNames.map((name) => labels[name] ?? '').join('\u0001');
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderLabels(labelNames: readonly string[], key: string): string {
  if (labelNames.length === 0) {
    return '';
  }
  const values = key.split('\u0001');
  const pairs = labelNames.map(
    (name, index) => `${name}="${escapeLabelValue(values[index] ?? '')}"`,
  );
  return `{${pairs.join(',')}}`;
}

class Counter {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
  ) {}

  inc(labels: Labels = {}, delta = 1): void {
    const key = labelKey(this.labelNames, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + delta);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    }
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${renderLabels(this.labelNames, key)} ${value}`);
    }
    return lines.join('\n');
  }
}

class Gauge {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
  ) {}

  set(value: number, labels: Labels = {}): void {
    this.values.set(labelKey(this.labelNames, labels), value);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    }
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${renderLabels(this.labelNames, key)} ${value}`);
    }
    return lines.join('\n');
  }
}

class Histogram {
  private readonly sums = new Map<string, number>();
  private readonly counts = new Map<string, number>();
  private readonly bucketCounts = new Map<string, number[]>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
    readonly buckets: readonly number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  ) {}

  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(this.labelNames, labels);
    let buckets = this.bucketCounts.get(key);
    if (buckets === undefined) {
      buckets = Array.from({ length: this.buckets.length + 1 }, () => 0);
      this.bucketCounts.set(key, buckets);
    }
    const upperBoundIndex = this.buckets.findIndex((bound) => value <= bound);
    const index = upperBoundIndex === -1 ? this.buckets.length : upperBoundIndex;
    buckets[index] = (buckets[index] ?? 0) + 1;
    this.sums.set(key, (this.sums.get(key) ?? 0) + value);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, buckets] of this.bucketCounts) {
      let cumulative = 0;
      const renderedLabels = renderLabels(this.labelNames, key);
      const labelBody = renderedLabels.slice(1, -1);
      const prefix = labelBody === '' ? '' : `${labelBody},`;
      this.buckets.forEach((bound, index) => {
        cumulative += buckets[index] ?? 0;
        lines.push(`${this.name}_bucket{${prefix}le="${bound}"} ${cumulative}`);
      });
      cumulative += buckets[this.buckets.length] ?? 0;
      lines.push(`${this.name}_bucket{${prefix}le="+Inf"} ${cumulative}`);
      lines.push(`${this.name}_sum${renderedLabels} ${this.sums.get(key) ?? 0}`);
      lines.push(`${this.name}_count${renderedLabels} ${this.counts.get(key) ?? 0}`);
    }
    return lines.join('\n');
  }
}

/**
 * Registry de métricas Prometheus sem dependência externa: counters, gauges e
 * histograms com labels, expostos no formato de texto padrão. Cada instância é
 * isolada — os testes criam a sua própria; o processo usa `defaultMetrics`.
 */
export class PrometheusMetrics implements MetricsPort {
  private readonly transactions = new Counter(
    'wager_transactions_total',
    'Transações processadas por status, kind e fonte',
    ['status', 'kind', 'source'],
  );
  private readonly duplicates = new Counter(
    'wager_duplicates_total',
    'Entregas duplicadas ignoradas por escopo',
    ['scope'],
  );
  private readonly idempotencyConflicts = new Counter(
    'wager_idempotency_conflicts_total',
    'Conflitos de idempotency key com payload divergente',
  );
  private readonly rejections = new Counter(
    'wager_rejections_total',
    'Rejeições de negócio por failure code',
    ['failure_code'],
  );
  private readonly referenceRetries = new Counter(
    'wager_reference_retries_total',
    'Desfechos do reprocessamento de referências ausentes',
    ['outcome'],
  );
  private readonly messageRetries = new Counter(
    'wager_message_retries_total',
    'Mensagens de fila que falharam e serão reentregues',
  );
  private readonly dlqMessages = new Counter(
    'wager_dlq_messages_total',
    'Mensagens enviadas à dead letter queue',
    ['reason'],
  );
  private readonly lockConflicts = new Counter(
    'wager_lock_conflicts_total',
    'Conflitos de lock (deadlock/serialização) no banco',
  );
  private readonly outboxPublish = new Counter(
    'wager_outbox_publish_total',
    'Publicações na fila de eventos',
    ['outcome'],
  );
  private readonly reconciliations = new Counter(
    'wager_reconciliations_total',
    'Reconciliações de saldo',
    ['outcome'],
  );
  private readonly outboxPending = new Gauge(
    'wager_outbox_pending',
    'Mensagens de outbox ainda não publicadas',
  );
  private readonly outboxLagSeconds = new Gauge(
    'wager_outbox_lag_seconds',
    'Idade da mensagem mais antiga pendente na outbox',
  );
  private readonly walletLockWait = new Histogram(
    'wager_wallet_lock_wait_ms',
    'Tempo de espera pelo lock FOR UPDATE da wallet (ms)',
  );
  private readonly processingDuration = new Histogram(
    'wager_processing_duration_ms',
    'Duração do processamento de uma transação (ms)',
    ['source'],
  );

  countTransaction(
    status: WagerTransactionStatus,
    kind: WagerTransactionKind,
    source: string,
  ): void {
    this.transactions.inc({ status: String(status), kind: String(kind), source });
  }

  countDuplicate(scope: 'inbox' | 'idempotency'): void {
    this.duplicates.inc({ scope });
  }

  countIdempotencyConflict(): void {
    this.idempotencyConflicts.inc();
  }

  countRejection(code: FailureCode): void {
    this.rejections.inc({ failure_code: String(code) });
  }

  countReferenceRetry(exhausted: boolean): void {
    this.referenceRetries.inc({ outcome: exhausted ? 'exhausted' : 'retry' });
  }

  countMessageRetry(): void {
    this.messageRetries.inc();
  }

  countDlq(reason: string): void {
    this.dlqMessages.inc({ reason });
  }

  countLockConflict(): void {
    this.lockConflicts.inc();
  }

  observeWalletLockWait(ms: number): void {
    this.walletLockWait.observe(ms);
  }

  observeProcessingDuration(source: string, ms: number): void {
    this.processingDuration.observe(ms, { source });
  }

  countOutboxPublish(outcome: 'success' | 'failure'): void {
    this.outboxPublish.inc({ outcome });
  }

  setOutboxState(pending: number, lagSeconds: number): void {
    this.outboxPending.set(pending);
    this.outboxLagSeconds.set(lagSeconds);
  }

  countReconciliation(consistent: boolean): void {
    this.reconciliations.inc({ outcome: consistent ? 'consistent' : 'divergent' });
  }

  /** Texto de exposição Prometheus (GET /metrics). */
  render(): string {
    return [
      this.transactions.render(),
      this.duplicates.render(),
      this.idempotencyConflicts.render(),
      this.rejections.render(),
      this.referenceRetries.render(),
      this.messageRetries.render(),
      this.dlqMessages.render(),
      this.lockConflicts.render(),
      this.outboxPublish.render(),
      this.reconciliations.render(),
      this.outboxPending.render(),
      this.outboxLagSeconds.render(),
      this.walletLockWait.render(),
      this.processingDuration.render(),
    ].join('\n');
  }
}

/** Instância usada pelo processo. Os testes criam instâncias próprias. */
export const defaultMetrics = new PrometheusMetrics();
