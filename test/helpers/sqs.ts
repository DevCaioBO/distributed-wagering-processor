import { SQSClient } from '@aws-sdk/client-sqs';
import { SqsGateway } from '../../src/infra/messaging/sqs-gateway.js';
import { sqsConfigFromEnv, type SqsConfig } from '../../src/infra/messaging/sqs-config.js';

/**
 * Gateway SQS real para os testes, apontando para o MiniStack do docker-compose.
 * Os nomes das filas vêm do ambiente (iguais aos do script infra:queues).
 */
export function getTestSqsConfig(): SqsConfig {
  return sqsConfigFromEnv();
}

export function getTestSqsGateway(): SqsGateway {
  const config = getTestSqsConfig();
  return new SqsGateway(config.endpoint, config.region);
}

/** SqsGateway com um client substituto — para injetar falhas de envio. */
export function getTestSqsGatewayWith(client: SQSClient): SqsGateway {
  const config = getTestSqsConfig();
  return new SqsGateway(config.endpoint, config.region, client);
}

/** Esvazia todas as filas usadas pelos testes (o purge é assíncrono no SQS). */
export async function purgeTestQueues(gateway: SqsGateway, config: SqsConfig): Promise<void> {
  await gateway.purge(config.transactionsQueueUrl);
  await gateway.purge(config.transactionsDlqUrl);
  await gateway.purge(config.eventsQueueUrl);
}

/** Consome até a fila ficar vazia ou o limite de tempo — com poll curto. */
export async function drainQueue(
  gateway: SqsGateway,
  queueUrl: string,
  options: { maxPolls?: number; waitSeconds?: number } = {},
): Promise<string[]> {
  const bodies: string[] = [];
  const maxPolls = options.maxPolls ?? 10;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const messages = await gateway.receive(queueUrl, {
      maxMessages: 10,
      waitSeconds: options.waitSeconds ?? 1,
      visibilityTimeoutSeconds: 0,
    });
    if (messages.length === 0) {
      break;
    }
    for (const message of messages) {
      if (message.Body !== undefined) {
        bodies.push(message.Body);
      }
      if (message.ReceiptHandle !== undefined) {
        await gateway.delete(queueUrl, message.ReceiptHandle);
      }
    }
  }
  return bodies;
}
