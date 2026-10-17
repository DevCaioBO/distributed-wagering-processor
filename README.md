# Wagering Processor

Serviço que processa transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) de múltiplos provedores, mantendo saldo e ledger consistentes.

Implementação do [desafio técnico da Jungle Gaming](https://github.com/junglegaming/backend-challenge/blob/main/README.md).

Estado atual: domínio completo (`Money`, `WalletLedgerEntry`, `Wallet`, `WagerTransaction` e `FailureCode`) com testes unitários. Ainda não há banco, filas nem endpoints.

## Requisitos

- [Bun](https://bun.sh) 1.x

## Setup

```bash
bun install
```

## Comandos

| Comando | O que faz |
| --- | --- |
| `bun test` | roda os testes |
| `bun run test:watch` | testes em modo watch |
| `bun run test:cov` | testes com cobertura |
| `bun run start:dev` | sobe a aplicação com recarga automática |
| `bun run lint` | roda o oxlint |

## Estrutura

```
src/
  domain/    regras de negócio, sem NestJS e sem ORM
  main.ts
```

## Testes

Os testes do domínio são unitários e rodam só com `bun test`. Os testes de integração e de concorrência vão usar PostgreSQL e SQS reais em containers, sem mocks, como o desafio exige.

As decisões de arquitetura estão em [ARCHITECTURE.md](./ARCHITECTURE.md).