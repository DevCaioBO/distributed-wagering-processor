# Wagering Processor

Serviço que processa transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) de múltiplos provedores, mantendo saldo e ledger consistentes.

Implementação do [desafio técnico da Jungle Gaming](https://github.com/junglegaming/backend-challenge/blob/main/README.md).

## Estado atual

- Domínio completo, com testes unitários: `Money`, `WalletLedgerEntry`, `Wallet`, `WagerTransaction` (incluindo a abertura interna `OPENING`) e `FailureCode`.
- Ambiente local com PostgreSQL e MiniStack (SQS) via Docker Compose.
- Schema do banco com as garantias de unicidade, imutabilidade e não-negatividade, em SQL versionado (`up` e `down`), com script que tenta violar cada garantia.
- Ainda não há banco integrado à aplicação (ORM) nem endpoints.

## Requisitos

- [Bun](https://bun.sh) 1.x
- [Docker](https://www.docker.com) com Docker Compose (no Windows, Docker Desktop aberto)

## Setup

```bash
bun install
cp .env.example .env
bun run infra:up
bun run infra:queues
```

O `.env` não vai para o Git. Os valores do `.env.example` já funcionam para desenvolvimento local.

As filas do MiniStack somem quando o container é recriado. Se isso acontecer, rode `bun run infra:queues` de novo.

## Comandos

| Comando | O que faz |
| --- | --- |
| `bun test` | roda os testes |
| `bun run test:watch` | testes em modo watch |
| `bun run test:cov` | testes com cobertura |
| `bun run start:dev` | sobe a aplicação com recarga automática |
| `bun run lint` | roda o oxlint |
| `bun run infra:up` | sobe PostgreSQL e MiniStack em containers |
| `bun run infra:down` | derruba os containers e mantém os dados |
| `bun run infra:reset` | derruba os containers e apaga os dados do banco |
| `bun run infra:queues` | cria a fila `wager-transactions.fifo` e a DLQ no MiniStack |

## Verificando o ambiente

```bash
docker compose ps
curl http://localhost:4566/_ministack/health
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select 1"'
```

O serviço `postgres` deve aparecer como `healthy` no `docker compose ps`.

Os comandos usam as variáveis `POSTGRES_USER` e `POSTGRES_DB` que já existem dentro do container, então funcionam com qualquer usuário definido no `.env`.

## Banco de dados

O schema fica em `db/`:

```
db/
  migrations/
    0001-initial.up.sql      cria wallets, wager_transactions e wallet_ledger_entries
    0001-initial.down.sql    desfaz tudo
  checks/
    0001-constraints.sql     tenta violar cada garantia do schema
```

Por enquanto as migrations são aplicadas com `psql`, dentro do container:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/migrations/0001-initial.up.sql
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/checks/0001-constraints.sql
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/migrations/0001-initial.down.sql
```

Para listar as tabelas:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'
```

Com o `up` aplicado, aparecem `wager_transactions`, `wallet_ledger_entries` e `wallets`.

O script de checks imprime `ok` para cada garantia que o banco recusa violar. O ORM vai assumir o controle de versões das migrations nas próximas etapas.

## Estrutura

```
src/
  domain/    regras de negócio, sem NestJS e sem ORM
  main.ts
db/
  migrations/    SQL versionado, com up e down
  checks/        scripts que tentam violar as garantias do schema
scripts/
  create-queues.ts    cria as filas SQS no MiniStack
docker-compose.yml    PostgreSQL 16 e MiniStack
.env.example          variáveis de ambiente de exemplo
```

## Testes

Os testes do domínio são unitários e rodam só com `bun test` (110 testes). Os testes de integração e de concorrência vão usar PostgreSQL e SQS reais em containers, sem mocks, como o desafio exige.

## Decisões

As decisões de arquitetura estão em [ARCHITECTURE.md](./ARCHITECTURE.md).