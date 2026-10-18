import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  PurgeQueueCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';

export interface SqsSendOptions {
  /** Deduplicação da FIFO: o id do evento/outbox impede duplicatas na janela de 5 min. */
  dedupId?: string;
  /** Chave de agrupamento FIFO: preserva ordem por agregado (wallet). */
  groupId?: string;
}

export interface SqsReceiveOptions {
  maxMessages?: number;
  waitSeconds?: number;
  visibilityTimeoutSeconds?: number;
}

export interface SqsGatewayPort {
  send(queueUrl: string, body: string, options?: SqsSendOptions): Promise<void>;
  receive(queueUrl: string, options?: SqsReceiveOptions): Promise<Message[]>;
  delete(queueUrl: string, receiptHandle: string): Promise<void>;
  changeVisibility(
    queueUrl: string,
    receiptHandle: string,
    visibilityTimeoutSeconds: number,
  ): Promise<void>;
  purge(queueUrl: string): Promise<void>;
}

/**
 * Gateway SQS de verdade (AWS SDK contra o emulador local ou a AWS real).
 * Nada de broker em memória: os testes de integração usam o mesmo caminho de
 * produção.
 */
export class SqsGateway implements SqsGatewayPort {
  private readonly client: SQSClient;

  constructor(endpoint: string, region: string, client?: SQSClient) {
    this.client = client ?? new SQSClient({ endpoint, region });
  }

  async send(queueUrl: string, body: string, options: SqsSendOptions = {}): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: body,
        // FIFO exige MessageGroupId e MessageDeduplicationId.
        MessageGroupId: options.groupId,
        MessageDeduplicationId: options.dedupId,
      }),
    );
  }

  async receive(queueUrl: string, options: SqsReceiveOptions = {}): Promise<Message[]> {
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: options.maxMessages ?? 10,
        WaitTimeSeconds: options.waitSeconds ?? 10,
        VisibilityTimeout: options.visibilityTimeoutSeconds,
      }),
    );
    return result.Messages ?? [];
  }

  async delete(queueUrl: string, receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
    );
  }

  async changeVisibility(
    queueUrl: string,
    receiptHandle: string,
    visibilityTimeoutSeconds: number,
  ): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeoutSeconds,
      }),
    );
  }

  async purge(queueUrl: string): Promise<void> {
    await this.client.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
  }
}
