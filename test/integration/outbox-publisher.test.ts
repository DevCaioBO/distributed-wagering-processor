import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { closeTestOrm, getTestEm, getTestOrm, type TestEm } from '../helpers/orm.js';
import { seedWallet, truncateBusinessTables, uniqueSuffix } from '../helpers/fixtures.js';
import { getTestSqsConfig, getTestSqsGateway, purgeTestQueues, drainQueue } from '../helpers/sqs.js';
import { makeSubmit, payload, silentLogger, testMetrics } from '../helpers/usecases.js';
import { OutboxPublisherWorker } from '../../src/infra/messaging/outbox-publisher.worker.js';
import { SqsGateway } from '../../src/infra/messaging/sqs-gateway.js';
import { SQSClient } from '@aws-sdk/client-sqs';

let em: TestEm;

const config = getTestSqsConfig();
const gateway = getTestSqsGateway();
const logger = silentLogger();

function makePublisher(emForWorker: TestEm, queueGateway: SqsGateway): OutboxPublisherWorker {
  return new OutboxPublisherWorker(emForWorker, queueGateway, testMetrics(), logger, {
    eventsQueueUrl: config.eventsQueueUrl,
    pollIntervalMs: 10_000,
    batchSize: 50,
  });
}

/** Gateway que falha ao publicar — simula o broker indisponível. */
class FlakyGateway extends SqsGateway {
  public failNext = 0;

  override async send(queueUrl: string, body: string, options?: Parameters<SqsGateway['send']>[2]): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('broker indisponível (simulado)');
    }
    return super.send(queueUrl, body, options);
  }
}

async function pendingOutboxCount(emRef: TestEm): Promise<number> {
  const rows = await emRef.execute<{ count: string }[]>(
    `select count(*)::text as count from outbox_messages where published_at is null`,
    [],
    'all',
  );
  return Number(rows[0]?.count ?? '0');
}

beforeAll(async () => {
  em = await getTestEm();
});

afterAll(async () => {
  await closeTestOrm();
});

beforeEach(async () => {
  await truncateBusinessTables(em);
  await purgeTestQueues(gateway, config);
});

describe('outbox: publicação de eventos após o commit', () => {
  it('publica no SQS apenas depois do commit e marca published_at', async () => {
    const playerId = `outbox-${uniqueSuffix()}`;
    const walletId = await seedWallet(em, { playerId, currency: 'BRL', balance: '100.00' });

    // O evento já está gravado na outbox na mesma transação da mudança de saldo.
    const submit = makeSubmit(em);
    await submit.execute({
      idempotencyKey: `${playerId}:bet-1`,
      correlationId: 'test',
      source: 'HTTP',
      payload: payload({
        walletId,
        playerId,
        providerId: playerId,
        externalTransactionId: 'bet-1',
        amount: '10.00',
      }),
    });

    const pendingBefore = await pendingOutboxCount(em);
    expect(pendingBefore).toBeGreaterThan(0);

    const published = await makePublisher(em, gateway).publishDueBatch();
    expect(published).toBe(pendingBefore);
    expect(await pendingOutboxCount(em)).toBe(0);

    const bodies = await drainQueue(gateway, config.eventsQueueUrl);
    const events = bodies.map((body) => JSON.parse(body) as { eventType: string });
    expect(events.length).toBe(pendingBefore);
    expect(events.some((event) => event.eventType === 'WagerTransactionProcessed')).toBe(true);
  });

  it('falha de envio agenda retry com backoff e não marca como publicado', async () => {
    const playerId = `outbox-retry-${uniqueSuffix()}`;
    const walletId = await seedWallet(em, { playerId, currency: 'BRL', balance: '100.00' });
    await makeSubmit(em).execute({
      idempotencyKey: `${playerId}:bet-1`,
      correlationId: 'test',
      source: 'HTTP',
      payload: payload({ walletId, playerId, providerId: playerId, externalTransactionId: 'bet-1' }),
    });

    const flaky = new FlakyGateway(config.endpoint, config.region);
    flaky.failNext = 1;
    const published = await makePublisher(em, flaky).publishDueBatch();
    expect(published).toBe(0);
    expect(await pendingOutboxCount(em)).toBeGreaterThan(0);

    // O retry foi agendado no futuro (backoff) — força o vencimento e tenta de novo.
    await em.execute(
      `update outbox_messages set next_attempt_at = now() - interval '1 second' where published_at is null`,
      [],
      'run',
    );
    const attemptsRows = await em.execute<{ attempts: number }[]>(
      `select attempts from outbox_messages where published_at is null limit 1`,
      [],
      'all',
    );
    expect(attemptsRows[0]?.attempts).toBeGreaterThanOrEqual(1);

    const retried = await makePublisher(em, gateway).publishDueBatch();
    expect(retried).toBeGreaterThan(0);
    expect(await pendingOutboxCount(em)).toBe(0);
  });

  it('dois publishers concorrentes não duplicam eventos (SKIP LOCKED + dedupId)', async () => {
    const playerId = `outbox-race-${uniqueSuffix()}`;
    const walletId = await seedWallet(em, { playerId, currency: 'BRL', balance: '1.00' });
    const submit = makeSubmit(em);
    for (let index = 0; index < 5; index += 1) {
      await submit.execute({
        idempotencyKey: `${playerId}:bet-${index}`,
        correlationId: 'test',
        source: 'HTTP',
        payload: payload({
          walletId,
          playerId,
          providerId: playerId,
          externalTransactionId: `bet-${index}`,
          amount: '0.10',
        }),
      });
    }

    const total = await pendingOutboxCount(em);
    expect(total).toBeGreaterThan(0);

    // Duas "instâncias" (EntityManagers distintos) publicando ao mesmo tempo.
    const orm = await getTestOrm();
    const workerA = makePublisher(orm.em.fork() as TestEm, gateway);
    const workerB = makePublisher(orm.em.fork() as TestEm, gateway);
    await Promise.all([workerA.publishDueBatch(), workerB.publishDueBatch()]);

    const bodies = await drainQueue(gateway, config.eventsQueueUrl);
    const eventIds = bodies.map((body) => (JSON.parse(body) as { eventId: string }).eventId);
    expect(eventIds.length).toBe(total);
    // Nenhum evento publicado duas vezes.
    expect(new Set(eventIds).size).toBe(eventIds.length);
    expect(await pendingOutboxCount(em)).toBe(0);
  });
});

// Mantém o import do SQSClient usado na assinatura de FlakyGateway? não é necessário;
// o tipo de opções vem de SqsGateway. (Referência mantida para leitura do arquivo.)
void SQSClient;
