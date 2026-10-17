import { MikroORM } from '@mikro-orm/postgresql';
import { buildMikroOrmConfig } from '../src/infra/database/mikro-orm.options.js';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === '') {
  throw new Error('DATABASE_URL is required');
}

const command = process.argv[2];

if (command !== 'up' && command !== 'down' && command !== 'status') {
  throw new Error('Usage: bun run scripts/migrate.ts <up|down|status>');
}

const orm = await MikroORM.init(buildMikroOrmConfig(databaseUrl));

try {
  if (command === 'up') {
    await orm.migrator.up();
  } else if (command === 'down') {
    await orm.migrator.down();
  }

  const executed = await orm.migrator.getExecuted();
  const pending = await orm.migrator.getPending();

  console.log(
    `Executadas: ${executed.map((m) => m.name).join(', ') || '(nenhuma)'}`,
  );
  console.log(
    `Pendentes:  ${pending.map((m) => m.name).join(', ') || '(nenhuma)'}`,
  );
} finally {
  await orm.close(true);
}