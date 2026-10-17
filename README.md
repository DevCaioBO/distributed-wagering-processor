# Wagering Processor

Serviço que processa transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) de múltiplos provedores, mantendo saldo e ledger consistentes.

Implementação do [desafio técnico da Jungle Gaming](https://github.com/junglegaming/backend-challenge/blob/main/README.md).

Estado atual: domínio completo (`Money`, `WalletLedgerEntry`, `Wallet`, `WagerTransaction` e `FailureCode`) com testes unitários, e ambiente local com PostgreSQL e MiniStack (SQS) via Docker Compose. Ainda não há migrations, banco integrado à aplicação nem endpoints.

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
docker compose exec postgres psql -U wagering -d wagering -c "select 1"
```

O serviço `postgres` deve aparecer como `healthy` no `docker compose ps`.

## Estrutura

```
src/
  domain/    regras de negócio, sem NestJS e sem ORM
  main.ts
scripts/
  create-queues.ts    cria as filas SQS no MiniStack
docker-compose.yml    PostgreSQL 16 e MiniStack
.env.example          variáveis de ambiente de exemplo
```

## Testes

Os testes do domínio são unitários e rodam só com `bun test`. Os testes de integração e de concorrência vão usar PostgreSQL e SQS reais em containers, sem mocks, como o desafio exige.

As decisões de arquitetura estão em [ARCHITECTURE.md](./ARCHITECTURE.md).