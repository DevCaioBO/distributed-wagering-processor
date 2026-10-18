import { setDefaultResultOptions } from 'node:util';

// Os testes de integração dependem do ambiente real (Postgres + SQS local).
// Este setup roda antes de todos os arquivos de teste e garante que a
// DATABASE_URL esteja definida, senão aborta com mensagem clara.

if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL.trim() === '') {
  process.env.DATABASE_URL =
    'postgresql://wagering:wagering@localhost:5433/wagering';
}
if (process.env.AWS_ENDPOINT_URL === undefined || process.env.AWS_ENDPOINT_URL.trim() === '') {
  process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
}
if (process.env.AWS_REGION === undefined) {
  process.env.AWS_REGION = 'us-east-1';
}

setDefaultResultOptions({ error: true });
