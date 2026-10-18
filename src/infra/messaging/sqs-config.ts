export interface SqsConfig {
  endpoint: string;
  region: string;
  /** Fila FIFO de entrada de transações (HTTP é publicado nela ou processado direto). */
  transactionsQueueUrl: string;
  /** DLQ da fila de transações (payloads inválidos e falhas persistentes). */
  transactionsDlqUrl: string;
  /** Fila FIFO de eventos de integração (saída da outbox). */
  eventsQueueUrl: string;
}

/**
 * Configuração de filas a partir do ambiente. O endpoint é obrigatório: este
 * processo só conversa com o emulador local (MiniStack) ou, em produção, com o
 * SQS real — nunca com um broker inventado.
 */
export function sqsConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SqsConfig {
  const endpoint = env.AWS_ENDPOINT_URL;
  if (!endpoint) {
    throw new Error('AWS_ENDPOINT_URL é obrigatória (SQS local ou real)');
  }
  const region = env.AWS_REGION ?? 'us-east-1';
  const transactionsQueueUrl = env.SQS_QUEUE_URL ?? queueUrlFor(endpoint, region, env.SQS_QUEUE_NAME ?? 'wager-transactions.fifo');
  const transactionsDlqUrl = env.SQS_DLQ_URL ?? queueUrlFor(endpoint, region, env.SQS_DLQ_NAME ?? 'wager-transactions-dlq.fifo');
  const eventsQueueUrl = env.SQS_EVENTS_QUEUE_URL ?? queueUrlFor(endpoint, region, env.SQS_EVENTS_QUEUE_NAME ?? 'wager-events.fifo');
  return { endpoint, region, transactionsQueueUrl, transactionsDlqUrl, eventsQueueUrl };
}

/** URL padrão do SQS local: endpoint + accountId fictícia + nome da fila. */
export function queueUrlFor(endpoint: string, region: string, queueName: string): string {
  void region;
  const base = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
  return `${base}/000000000000/${queueName}`;
}
