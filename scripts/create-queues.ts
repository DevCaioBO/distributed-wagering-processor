import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

const MAX_RECEIVE_COUNT = 5;
const VISIBILITY_TIMEOUT_SECONDS = 30;

const endpoint = process.env.AWS_ENDPOINT_URL;
const region = process.env.AWS_REGION ?? 'us-east-1';
const queueName = process.env.SQS_QUEUE_NAME ?? 'wager-transactions.fifo';
const dlqName = process.env.SQS_DLQ_NAME ?? 'wager-transactions-dlq.fifo';
const eventsQueueName = process.env.SQS_EVENTS_QUEUE_NAME ?? 'wager-events.fifo';
const eventsDlqName = process.env.SQS_EVENTS_DLQ_NAME ?? 'wager-events-dlq.fifo';

if (!endpoint) {
  throw new Error(
    'AWS_ENDPOINT_URL não definida: o script só roda contra o emulador local, nunca contra a AWS real',
  );
}

const client = new SQSClient({ endpoint, region });

async function createFifoQueue(
  name: string,
  extraAttributes: Record<string, string> = {},
): Promise<string> {
  const result = await client.send(
    new CreateQueueCommand({
      QueueName: name,
      Attributes: { FifoQueue: 'true', ...extraAttributes },
    }),
  );
  if (!result.QueueUrl) {
    throw new Error(`O SQS não devolveu a URL da fila ${name}`);
  }
  return result.QueueUrl;
}

async function queueArn(queueUrl: string): Promise<string> {
  const result = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['QueueArn'],
    }),
  );
  const arn = result.Attributes?.QueueArn;
  if (!arn) {
    throw new Error(`O SQS não devolveu o ARN da fila ${queueUrl}`);
  }
  return arn;
}

// DLQs primeiro: as filas principais referenciam os ARNs delas no redrive.
const dlqUrl = await createFifoQueue(dlqName);
const dlqArn = await queueArn(dlqUrl);
const eventsDlqUrl = await createFifoQueue(eventsDlqName);
const eventsDlqArn = await queueArn(eventsDlqUrl);

const queueUrl = await createFifoQueue(queueName, {
  VisibilityTimeout: String(VISIBILITY_TIMEOUT_SECONDS),
  RedrivePolicy: JSON.stringify({
    deadLetterTargetArn: dlqArn,
    maxReceiveCount: MAX_RECEIVE_COUNT,
  }),
});

// Fila de eventos de integração (saída do worker da outbox). Dedup de 5 min
// com dedupId = id da outbox: republicação pós-crash não duplica eventos.
const eventsQueueUrl = await createFifoQueue(eventsQueueName, {
  VisibilityTimeout: String(VISIBILITY_TIMEOUT_SECONDS),
  RedrivePolicy: JSON.stringify({
    deadLetterTargetArn: eventsDlqArn,
    maxReceiveCount: MAX_RECEIVE_COUNT,
  }),
});

console.log(`DLQ de transações:  ${dlqUrl}`);
console.log(`Fila de transações: ${queueUrl}`);
console.log(`DLQ de eventos:     ${eventsDlqUrl}`);
console.log(`Fila de eventos:    ${eventsQueueUrl}`);
