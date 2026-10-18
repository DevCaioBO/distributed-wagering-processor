import { MikroORM } from '@mikro-orm/core';
import type { EntityManager, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { buildMikroOrmConfig } from '../../src/infra/database/mikro-orm.options.js';

export type TestEm = EntityManager;

/**
 * ORM compartilhado pelos testes de integração. Aponta para o PostgreSQL do
 * docker-compose (DATABASE_URL) — o mesmo schema de produção, com migrations
 * aplicadas pelo setup.
 */
let orm: MikroORM<PostgreSqlDriver> | undefined;

export async function getTestOrm(): Promise<MikroORM<PostgreSqlDriver>> {
  if (orm === undefined) {
    const clientUrl = process.env.DATABASE_URL;
    if (clientUrl === undefined || clientUrl.trim() === '') {
      throw new Error(
        'DATABASE_URL é obrigatória para os testes de integração — suba o docker compose (bun run infra:up)',
      );
    }
    orm = await MikroORM.init(buildMikroOrmConfig(clientUrl));
    await orm.migrator.up();
  }
  return orm;
}

export async function getTestEm(): Promise<TestEm> {
  const o = await getTestOrm();
  return o.em.fork() as TestEm;
}

export async function closeTestOrm(): Promise<void> {
  if (orm !== undefined) {
    await orm.close(true);
    orm = undefined;
  }
}