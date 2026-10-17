# Wagering Processor

Serviço que processa transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) de múltiplos provedores, mantendo saldo e ledger consistentes.

Implementação do [desafio técnico da Jungle Gaming](https://github.com/junglegaming/backend-challenge/blob/main/README.md).

## Estado atual

- Domínio completo, com testes unitários: `Money`, `WalletLedgerEntry`, `Wallet`, `WagerTransaction` (incluindo a abertura interna `OPENING`) e `FailureCode`.
- Ambiente local com PostgreSQL e MiniStack (SQS) via Docker Compose.
- Schema do banco com as garantias de unicidade, imutabilidade e não-negatividade, em SQL versionado (`up` e `down`), com script que tenta violar cada garantia.
- MikroORM integrado: EntitySchema, mappers domínio ↔ row (dinheiro sempre como `string`), Migrator adotando a migration 0001.
- Health: `GET /health/live` e `GET /health/ready`.
- Ainda não há endpoints de negócio (`POST /wallets`, `POST /wagering/transactions`, etc.).

## Requisitos

- [Bun](https://bun.sh) 1.x
- [Docker](https://www.docker.com) com Docker Compose (no Windows, Docker Desktop aberto)

## Setup

```bash
bun install
cp .env.example .env
bun run infra:up
bun run db:migrate
bun run infra:queues
```

O `.env` não vai para o Git. Os valores do `.env.example` já funcionam para desenvolvimento local.

Se a porta 5432 já estiver ocupada (Postgres instalado no Windows, por exemplo), defina no `.env`:

```env
POSTGRES_PORT=5433
DATABASE_URL=postgresql://wagering:wagering@localhost:5433/wagering
```

As filas do MiniStack somem quando o container é recriado. Se isso acontecer, rode `bun run infra:queues` de novo.

## Comandos

| Comando                | O que faz                                                  |
| ---------------------- | ---------------------------------------------------------- |
| `bun test`             | roda os testes                                             |
| `bun run test:watch`   | testes em modo watch                                       |
| `bun run test:cov`     | testes com cobertura                                       |
| `bun run start:dev`    | sobe a aplicação com recarga automática                    |
| `bun run lint`         | roda o oxlint                                              |
| `bun run infra:up`     | sobe PostgreSQL e MiniStack em containers                  |
| `bun run infra:down`   | derruba os containers e mantém os dados                    |
| `bun run infra:reset`  | derruba os containers e apaga os dados do banco            |
| `bun run infra:queues` | cria a fila `wager-transactions.fifo` e a DLQ no MiniStack |
| `bun run db:migrate`   | aplica migrations pendentes                                |
| `bun run db:rollback`  | reverte a última migration                                 |
| `bun run db:status`    | lista migrations executadas e pendentes                    |

## Verificando o ambiente

```bash
docker compose ps
curl http://localhost:4566/_ministack/health
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select 1"'
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

O serviço `postgres` deve aparecer como `healthy` no `docker compose ps`.

Os comandos usam as variáveis `POSTGRES_USER` e `POSTGRES_DB` que já existem dentro do container, então funcionam com qualquer usuário definido no `.env`.

## Banco de dados

O schema fica em `db/`:

```
db/
  migrations/
    0001-initial.up.sql    cria wallets, wager_transactions e wallet_ledger_entries
    0001-initial.down.sql  desfaz tudo
  checks/
    0001-constraints.sql   tenta violar cada garantia do schema
```

As migrations são aplicadas pelo Migrator do MikroORM:

```bash
bun run db:migrate
bun run db:status
```

Para listar as tabelas:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'
```

Com a migration aplicada aparecem `wallets`, `wager_transactions`, `wallet_ledger_entries` e `mikro_orm_migrations`.

O script de checks imprime `ok` para cada garantia que o banco recusa violar:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/checks/0001-constraints.sql
```

## Estrutura

```
src/
  domain/                 regras de negócio, sem NestJS e sem ORM
  infra/database/         MikroORM config, schemas, mappers, migration wrapper
  health/                 live e ready
  main.ts
db/
  migrations/             SQL versionado, com up e down
  checks/                 scripts que tentam violar as garantias do schema
scripts/
  create-queues.ts        cria as filas SQS no MiniStack
  migrate.ts              aplica / reverte / lista migrations
docker-compose.yml        PostgreSQL 16 e MiniStack
.env.example              variáveis de ambiente de exemplo
```

## Testes

Os testes do domínio e dos mappers são unitários e rodam só com `bun test` (sem banco e sem fila). Os testes de integração e de concorrência vão usar PostgreSQL e SQS reais em containers, sem mocks, como o desafio exige.

## Decisões

As decisões de arquitetura estão em [ARCHITECTURE.md](./ARCHITECTURE.md).
```