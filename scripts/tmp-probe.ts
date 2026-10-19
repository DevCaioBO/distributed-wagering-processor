import { MikroORM } from '@mikro-orm/core';
import config from '../src/infra/database/mikro-orm.config.js';

const orm = await MikroORM.init(config);
const em = orm.em.fork();

const rows = await em.execute<Record<string, unknown>[]>(
  `select payload, attempts, published_at as "publishedAt"
     from outbox_messages order by occurred_at desc limit 1`,
  [],
  'all',
);
const row = rows[0] ?? {};
console.log('payload typeof:', typeof row.payload, 'value:', JSON.stringify(row.payload).slice(0, 120));
console.log('attempts typeof:', typeof row.attempts);
console.log('publishedAt typeof:', typeof row.publishedAt);
await orm.close(true);
