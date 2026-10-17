import { UnderscoreNamingStrategy } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';

import { WagerTransactionSchema, WalletLedgerEntrySchema, WalletSchema } from './schemas.js';
import { Migration0001Initial } from './migrations/0001-initial.migration.js';


export function buildMikroOrmConfig(clientUrl: string) {
  return defineConfig({
    clientUrl,
    entities: [WalletSchema, WagerTransactionSchema, WalletLedgerEntrySchema],
    namingStrategy: UnderscoreNamingStrategy,
    extensions: [Migrator],
    migrations: {
      tableName: 'mikro_orm_migrations',
      migrationsList: [{ name: 'Migration0001Initial', class: Migration0001Initial }],
      transactional: true,
      allOrNothing: true,
      snapshot: false,
    },
  });
}