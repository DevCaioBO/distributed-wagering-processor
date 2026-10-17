import { buildMikroOrmConfig } from './mikro-orm.options.js';

const clientUrl = process.env.DATABASE_URL;

if (clientUrl === undefined || clientUrl.trim() === '') {
  throw new Error('DATABASE_URL is required');
}

export default buildMikroOrmConfig(clientUrl);