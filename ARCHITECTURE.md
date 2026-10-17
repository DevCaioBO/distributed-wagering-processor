# ARCHITECTURE

Decisões tomadas até agora. As seções de concorrência, idempotência e mensageria serão escritas quando forem implementadas.

## 1. Bun no lugar do vitest

- Escolha: testes com `bun test`, imports de `bun:test`.
- Contexto: o `nest new` junta sistema de módulos e test runner numa pergunta só (ESM com vitest). O desafio exige Bun como test runner, então o vitest foi removido depois do scaffold, junto com seus arquivos de config e dependências, e os scripts de teste passaram a chamar `bun test`.
- Por quê: é exigência do desafio, e um runtime só evita diferença entre rodar e testar.
- Custo: ecossistema de testes menor e API de mock diferente da do Jest e do vitest.

## 2. Domínio sem framework

- Escolha: as classes de domínio não importam NestJS nem ORM. Construtor privado e factories estáticas (`from`, `create`, `createOpening`, `open`, `rehydrate`).
- Por quê: o domínio testa só com `bun test`, sem banco, e as regras ficam num lugar só. O desafio também pede isso.
- Custo: depois vai ser preciso código de mapeamento entre domínio e banco.

## 3. Dinheiro (`Money`)

- Escolha: o valor é um `bigint` em centavos (`2500n` é `25.00`). Entrada e saída são string decimal com 2 casas.
- Por quê: aritmética inteira é exata, sem erro de ponto flutuante e sem dependência extra. O desafio mostra `Decimal` no esqueleto, mas permite adaptar desde que as garantias fiquem: imutabilidade, exatidão e escala fixa de 2.
- Custo: converter string e `bigint` nas bordas (API, banco, eventos). O `toJSON` devolve `{ amount, currency }` porque `JSON.stringify` não aceita `bigint`.

Regras:

- `Money.from` rejeita `NaN`, `Infinity`, notação científica, vazio, mais de 2 casas e negativos. A moeda precisa ter 3 letras maiúsculas.
- `subtract` e `negate` podem dar negativo. A entrada é validada, mas o domínio precisa representar resultado de conta. Quem barra saldo negativo é a `Wallet`.
- A entrada aceita 0 a 2 casas (`"25"`, `"25.5"`, `"25.50"`), e a saída tem sempre 2. Mais de 2 casas é rejeitado, nunca arredondado.
- Operar moedas diferentes lança `CurrencyMismatchError`. `equals` entre moedas diferentes devolve `false`.

## 4. Ledger (`WalletLedgerEntry`)

- Escolha: cada lançamento guarda `money`, `balanceBefore`, `balanceAfter` e a direção (`DEBIT` ou `CREDIT`).
- Por quê: cada linha se audita sozinha, e a reconciliação consegue reconstruir o saldo.
- `create` valida que `balanceBefore ± money === balanceAfter`. `rehydrate` só reconstrói o que já foi persistido.
- Valor zero é rejeitado: `LOSS` e transações `REJECTED` não geram lançamento, então uma linha zerada seria bug.
- Saldo negativo é rejeitado, e o banco também barra (seção 13).
- Imutável: todos os campos são `readonly` e não há método que altere estado.
- Limitação: o objeto `Date` interno continua mutável.

## 5. Wallet

- Escolha: a `Wallet` é o Aggregate Root. `debit` e `credit` devolvem o `WalletLedgerEntry` correspondente.
- Por quê: não existe caminho no código que mude o saldo sem produzir o lançamento. A regra "toda alteração de saldo tem um lançamento" vale por construção.
- O lançamento é criado antes de o saldo mudar. Se ele falhar, a wallet fica intacta.
- `version` começa em 1 e só incrementa quando o saldo muda.
- `open` devolve a wallet e o lançamento de abertura (`CREDIT`), porque o README pede a wallet já com o saldo inicial e `version` 1. Saldo inicial zero não gera lançamento.
- Débito acima do saldo lança `InsufficientFundsError`. Moeda diferente da wallet lança `CurrencyMismatchError`. Valor zero ou negativo lança `InvalidWalletError`.
- A `Wallet` não conhece provedor, fila nem banco. O mesmo objeto atende qualquer provedor.
- A wallet é do jogador (`playerId` + moeda), não do provedor. Por isso a unidade de concorrência será a `walletId`, e não o provedor.
- Limitação: o domínio não protege contra concorrência. Isso é responsabilidade do banco (lock e constraints), nas próximas fases.

## 6. WagerTransaction

Representa uma operação recebida de um provedor, com o ciclo de vida dela.

### Estados e transições

```
PENDING -> PENDING_REFERENCE | PROCESSED | REJECTED | FAILED
PENDING_REFERENCE -> PENDING_REFERENCE | PROCESSED | REJECTED | FAILED
PROCESSED, REJECTED, FAILED: terminais
```

- Escolha: toda transição lança `InvalidTransactionStateError` se o estado atual já for terminal.
- Por quê: o README trata isso como erro de programação, não como caminho de negócio. Uma transação que chegou a um estado terminal nunca muda, e falhar alto evita corromper um resultado já devolvido ao provedor.
- `PENDING_REFERENCE` pode repetir: o worker de referências vai tentar de novo várias vezes, e enquanto a referência não chega a transação continua esperando.
- `markPendingReference` exige que a transação tenha declarado uma referência, e `markProcessed` de `REFUND` ou `ROLLBACK` exige o id interno da referência. Assim um estado inconsistente não chega a existir.
- `reject` guarda um `FailureCode` e `fail` também. `REJECTED` é violação de regra de negócio, e `FAILED` é erro permanente de infraestrutura.

### Criação

- `create` nasce `PENDING` e valida tudo que dá para validar sem consultar o banco: campos de texto não vazios, `kind` conhecido, referência exigida ou proibida por tipo, e valor.
- `BET` não pode ter referência. `REFUND` e `ROLLBACK` exigem. `WIN` e `LOSS` aceitam, com ou sem.
- Valor zero é rejeitado, exceto em `LOSS`, que só registra um resultado e não move saldo.
- `create` rejeita `OPENING` (tipo interno, não pode vir da API nem da fila) e rejeita o provedor reservado `system`, inclusive com espaços ao redor. Sem isso, um provedor externo poderia se passar pela abertura de wallet.

### Transação `OPENING`

- Escolha: `WagerTransaction.createOpening({ id, walletId, playerId, money, createdAt })`, factory interna que nasce `PROCESSED` com `processedAt` igual a `createdAt`.
- Por quê: o README exige provedor, id externo, idempotency key e payload hash em toda transação, e a abertura não vem de provedor nenhum. Em vez de deixar essas colunas `NULL` (o que enfraqueceria as unique constraints), a abertura recebe valores internos e determinísticos.
- Valores reservados: `providerId` é `system`; `externalTransactionId` e `idempotencyKey` são `opening:<walletId>`; `roundId` e `gameId` são `opening`; `payloadHash` é fixo (`opening`).
- Como as chaves dependem só da wallet, duas aberturas da mesma wallet colidem nas unique constraints, e wallets diferentes nunca colidem. No banco isso é reforçado por um índice único parcial (seção 13).
- Alternativa descartada: colunas anuláveis para a abertura. Enfraquece a unicidade `(provider_id, external_transaction_id)`, porque `NULL` nunca é igual a `NULL` no `UNIQUE` do PostgreSQL.
- A factory valida `id`, `walletId` e `playerId` não vazios e valor positivo. É a mesma regra do README: saldo inicial zero não gera `OPENING`.
- `OPENING` credita (`ledgerDirectionFor` devolve `CREDIT`), afeta saldo e não pede referência. Por nascer terminal, não aceita nenhuma transição.

### Direção do lançamento

- `BET` debita. `WIN`, `REFUND` e `OPENING` creditam. `LOSS` não tem direção e lança erro.
- `ROLLBACK` é o inverso da referência: reverter uma `BET` credita, reverter uma `WIN` ou um `REFUND` debita. Reverter outro `ROLLBACK` ou uma `LOSS` é erro.

### Validação da referência

- `validateReference(reference)` devolve um `FailureCode` ou `undefined`. Confere, nessa ordem: id externo, provedor, jogador, wallet, rodada e moeda iguais (`REFERENCE_MISMATCH`); tipo permitido (`INVALID_REFERENCE_KIND`); e, em `REFUND` e `ROLLBACK`, valor igual ao da referência (`AMOUNT_MISMATCH`).
- Tipos permitidos: `REFUND` referencia só `BET`. `ROLLBACK` referencia `BET`, `WIN` ou `REFUND`. `WIN` e `LOSS` referenciam só `BET`.
- O que fica de fora, de propósito, porque depende do banco e será do use case: a referência estar `PROCESSED`, a reversão única da mesma referência e saldo negativo causado pela reversão.
- Por quê: o domínio decide o que dá para decidir olhando só dois objetos, e devolve um código em vez de lançar, para o use case poder gravar a rejeição de forma auditável.

## 7. Códigos de falha (`FailureCode`)

O provedor precisa decidir sozinho se reenvia, corrige o payload ou desiste. Por isso cada código tem uma ação (`providerActionFor`), e o compilador obriga a definir a ação de todo código novo.

| Código                    | Situação                                                       | O provedor deve                              |
| ------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| `INSUFFICIENT_FUNDS`      | `BET` sem saldo                                                | desistir                                     |
| `REVERSAL_WOULD_OVERDRAW` | reversão deixaria o saldo negativo                             | falar com o suporte                          |
| `REFERENCE_NOT_FOUND`     | a referência não chegou dentro do limite de tentativas         | corrigir a referência ou reenviar a original |
| `REFERENCE_MISMATCH`      | referência de outro provedor, jogador, wallet, rodada ou moeda | corrigir o payload                           |
| `INVALID_REFERENCE_KIND`  | tipo de referência não permitido                               | corrigir o payload                           |
| `REFERENCE_NOT_PROCESSED` | a referência existe, mas foi rejeitada ou falhou               | desistir                                     |
| `ALREADY_REVERSED`        | a referência já foi revertida                                  | desistir                                     |
| `AMOUNT_MISMATCH`         | valor da reversão diferente do da referência                   | corrigir o payload                           |
| `CURRENCY_MISMATCH`       | moeda diferente da da wallet                                   | corrigir o payload                           |
| `WALLET_NOT_FOUND`        | wallet inexistente                                             | corrigir o payload                           |
| `WALLET_PLAYER_MISMATCH`  | a wallet não pertence ao jogador informado                     | corrigir o payload                           |
| `PROCESSING_FAILED`       | erro permanente de infraestrutura                              | falar com o suporte                          |

- Saldo insuficiente em aposta e reversão que estoura o saldo têm códigos e ações diferentes, como o README pede: na primeira o provedor não pode fazer nada, e a segunda é uma situação operacional que alguém precisa olhar.
- Falhas transitórias (banco fora do ar, por exemplo) não viram `FailureCode`. Elas não são gravadas como estado terminal: a operação é repetida, e só um erro permanente vira `FAILED`.
- Alguns códigos só passam a ser usados quando o use case existir (`WALLET_NOT_FOUND`, `ALREADY_REVERSED`, `REVERSAL_WOULD_OVERDRAW`, `REFERENCE_NOT_PROCESSED`, `CURRENCY_MISMATCH`, `WALLET_PLAYER_MISMATCH`). Estão no enum para a taxonomia já ficar completa e documentada.

## 8. Múltiplos provedores

O provedor é só uma identidade (`providerId`). Não há lógica por provedor no domínio. O que muda nas próximas fases:

- unicidade por provedor no banco: `(provider_id, external_transaction_id)` e `(provider_id, idempotency_key)`;
- a referência de `REFUND` e `ROLLBACK` resolve por `(providerId, referenceExternalTransactionId)`, então um provedor nunca reverte transação de outro. O domínio já confere isso em `validateReference`.

## 9. Estratégia de testes

- Domínio e mappers: testes unitários com `bun test`, sem banco e sem fila. Não há infraestrutura para substituir, então não há mock.
- Integração e concorrência (a partir da persistência de use cases): PostgreSQL e SQS reais em containers, com paralelismo real. O desafio elimina soluções que substituem PostgreSQL e SQS por mocks.
- O tempo é passado como parâmetro (`now`, `at`, `createdAt`), o que deixa os testes determinísticos.
- Garantias do schema: `db/checks/0001-constraints.sql` tenta violar cada garantia contra o PostgreSQL real e imprime `ok` quando o banco recusa (seção 13).

## 10. Ambiente local (Docker Compose)

- Escolha: `docker-compose.yml` com PostgreSQL 16 (`postgres:16-alpine`) e MiniStack (`ministackorg/ministack:1.5.28`), cada um num container.
- Por quê: os testes de integração e de concorrência precisam de PostgreSQL e SQS reais, e o desafio elimina quem os troca por mocks. Com Compose, quem clonar o repositório sobe o mesmo ambiente com um comando, e os testes com várias instâncias da aplicação apontam para o mesmo banco.
- Por que MiniStack e não LocalStack: o LocalStack passou a exigir token de autenticação. O MiniStack roda sem conta e atende SQS na porta 4566.
- O PostgreSQL guarda os dados num volume nomeado (`postgres-data`), que sobrevive a `docker compose down`. `docker compose down -v` (`bun run infra:reset`) apaga o volume e recomeça do zero.
- O serviço `postgres` tem healthcheck (`pg_isready`), então o Compose sabe quando o banco aceita conexão. O MiniStack não tem healthcheck no Compose, porque não há garantia de que a imagem tenha `curl`. A verificação é manual, pelo endpoint `/_ministack/health`.
- Configuração por variáveis de ambiente. O `.env.example` vai para o Git e o `.env` não. Os valores são só de desenvolvimento local: usuário e senha do banco inventados, e chaves AWS `test`, que o MiniStack não valida. O Compose tem valores padrão para todas as variáveis, então sobe mesmo sem `.env`.
- A imagem do MiniStack está fixada na versão 1.5.28 (a que o endpoint de health reportou), para o ambiente não mudar sozinho. O PostgreSQL fixa só a versão principal (16).
- Porta do Postgres no host: `POSTGRES_PORT` (padrão 5432). No Windows, se já existir um Postgres na 5432, usa-se `5433` no `.env` e o `DATABASE_URL` aponta para essa porta.
- Custo: atualizar o MiniStack passa a ser uma troca deliberada de versão, seguida de nova rodada de testes.

## 11. Filas SQS

- Escolha: `scripts/create-queues.ts` cria `wager-transactions.fifo` e `wager-transactions-dlq.fifo`, ambas FIFO. A fila principal tem `RedrivePolicy` apontando para a DLQ, com `maxReceiveCount` 5, e `VisibilityTimeout` de 30 segundos.
- Por quê: os nomes e o formato FIFO vêm do desafio. A DLQ recebe a mensagem depois de 5 recebimentos sem sucesso, e é onde ficam os erros permanentes.
- O script pode rodar mais de uma vez: o SQS devolve a fila existente quando a configuração é a mesma.
- O script se recusa a rodar sem `AWS_ENDPOINT_URL`. Sem isso o SDK usaria a AWS de verdade, e o script existe só para o emulador.
- As filas somem se o container do MiniStack for recriado, então `bun run infra:queues` precisa rodar de novo.
- Os valores de `maxReceiveCount` (5) e `VisibilityTimeout` (30 s) são provisórios. Serão justificados quando o consumidor existir.
- Limitação: o FIFO ordena e deduplica por grupo de mensagens, mas isso é otimização. A consistência continua sendo responsabilidade do banco, como o desafio exige.

## 12. Identificadores e tipos no banco

- Ids gerados pelo sistema (wallet, transação, lançamento): UUID v7 gerado na aplicação com `Bun.randomUUIDv7()`, fora do domínio. A coluna é `uuid` sem default no banco.
- Por quê: UUID v7 é ordenável por tempo, o que ajuda índice e paginação por cursor. Gerar na aplicação deixa o id existir antes do `INSERT`, então o domínio já nasce com ele e o lançamento do ledger já pode referenciar a transação.
- Alternativa descartada: `gen_random_uuid()` (v4) como default do banco. Não é ordenável e esconde a geração do id fora do código.
- Identificadores externos (jogador, provedor, id externo, idempotency key, rodada, jogo) são `text`, porque o formato é do provedor e não do sistema. No domínio, todo id é `string`.
- Dinheiro: `numeric(19,2)`, com a moeda numa coluna `text` à parte. O valor nunca pode ser lido como `number`; a leitura é sempre como string, convertida em `Money` nos mappers.
- Estado, tipo, direção e código de falha são `text` com `CHECK`, não `ENUM` do PostgreSQL. Mudar um `ENUM` exige `ALTER TYPE`, que é mais incômodo numa migration reversível, e o `CHECK` dá a mesma garantia.
- O mapeamento entre `numeric` e `Money` está nos mappers (`wallet.mapper`, `wager-transaction.mapper`, `wallet-ledger-entry.mapper`).

## 13. Schema do banco (migration 0001)

Arquivos: `db/migrations/0001-initial.up.sql`, `db/migrations/0001-initial.down.sql` e `db/checks/0001-constraints.sql`.

- Tabelas: `wallets`, `wager_transactions` e `wallet_ledger_entries`.
- Escolha: as garantias que o desafio chama de invioláveis (unicidade, imutabilidade e não-negatividade) ficam no schema, não só no código.
- Por quê: o código pode ter bug, e várias instâncias podem escrever ao mesmo tempo. O banco é o único ponto que todas as instâncias respeitam.
- Nas tabelas, o valor se chama `amount` (com `currency` ao lado). No domínio o mesmo dado é o `Money`.
- O SQL da migration **não** contém `BEGIN`/`COMMIT`: o Migrator do MikroORM já envolve a migration em transação.

### `wallets`

Colunas: `id` (uuid, chave primária), `player_id`, `currency`, `balance numeric(19,2)`, `version integer`, `created_at`, `updated_at`.

- Uma wallet por jogador e moeda: `UNIQUE (player_id, currency)`.
- Saldo nunca negativo: `CHECK (balance >= 0)`.
- Moeda com 3 letras maiúsculas e `version >= 1`.

### `wager_transactions`

Colunas: `id`, `provider_id`, `external_transaction_id`, `idempotency_key`, `payload_hash`, `wallet_id`, `player_id`, `round_id`, `game_id`, `kind`, `amount`, `currency`, `reference_external_transaction_id`, `reference_transaction_id`, `status`, `failure_code`, `created_at`, `processed_at`.

Unicidade:

- idempotência por provedor: `UNIQUE (provider_id, external_transaction_id)` e `UNIQUE (provider_id, idempotency_key)`;
- uma abertura por wallet: índice único parcial sobre `wallet_id` onde `kind = 'OPENING'`;
- `UNIQUE (id, wallet_id)`, que existe para o ledger apontar para a transação e a wallet juntas (ver abaixo).

Regras de consistência (todas `CHECK`):

- `kind` e `status` só aceitam os valores do enum; `failure_code` só aceita os códigos do `FailureCode`;
- `REJECTED` e `FAILED` exigem `failure_code`, e os demais estados o proíbem;
- `PROCESSED` exige `processed_at`, e os demais estados o proíbem;
- `REFUND` e `ROLLBACK` exigem referência, `BET` e `OPENING` a proíbem, `WIN` e `LOSS` aceitam as duas situações;
- valor nunca negativo, e positivo em todo tipo exceto `LOSS`;
- provedor `system` se, e somente se, o tipo for `OPENING`. Isso fecha por fora o que `WagerTransaction.create` já rejeita.

`reference_transaction_id` tem chave estrangeira para a própria tabela. `wallet_id` **não** tem chave estrangeira: assim uma transação para wallet inexistente pode ser gravada como `REJECTED` com `WALLET_NOT_FOUND`, e fica auditável.

### `wallet_ledger_entries`

Colunas: `id`, `wallet_id`, `transaction_id`, `direction`, `amount`, `currency`, `balance_before`, `balance_after`, `created_at`.

- No máximo um lançamento por transação e wallet: `UNIQUE (wallet_id, transaction_id)`.
- Aritmética do lançamento: `CHECK` que exige `balance_before - amount = balance_after` em `DEBIT` e `balance_before + amount = balance_after` em `CREDIT`.
- Valor positivo, saldos antes e depois não negativos, direção só `DEBIT` ou `CREDIT`, moeda com 3 letras.
- Imutável: o trigger `wallet_ledger_entries_immutable` roda antes de todo `UPDATE` e `DELETE` e chama `forbid_ledger_mutation()`, que recusa a operação.
- Chave estrangeira composta `(transaction_id, wallet_id)` para `wager_transactions (id, wallet_id)`, então um lançamento nunca aponta para a transação de outra wallet. Há também chave estrangeira de `wallet_id` para `wallets`.
- Índice `(wallet_id, created_at, id)`, pensado para a paginação por cursor do ledger.

### Limitações

- O trigger de imutabilidade é por linha. Ele não impede `TRUNCATE`, nem que o dono do banco remova o próprio trigger. A imutabilidade vale contra o código da aplicação, não contra quem administra o banco. Em produção o usuário da aplicação deveria ter só `INSERT` e `SELECT` no ledger.
- Algumas regras ainda dependem do use case, porque exigem olhar outras linhas: a referência estar `PROCESSED`, a reversão única e o saldo negativo causado por reversão.

### Como foi validado

`db/checks/0001-constraints.sql` tenta violar cada garantia (12 checks) e imprime `ok` quando o banco recusa. O `down` apaga tudo e deixa o `\dt` vazio, e o `up` reaplica do zero. A estrutura desta seção foi conferida com `\d` em cada tabela.

As migrations são aplicadas pelo Migrator do MikroORM (`bun run db:migrate` / `db:rollback` / `db:status`), adotando a 0001 como primeira migration.

## 14. MikroORM e mapeamento domínio ↔ banco

- Escolha: EntitySchema + row types (interfaces plain) + mappers puros. O domínio não importa MikroORM.
- Por quê: o desafio pede domínio sem framework; `numeric(19,2)` nunca pode virar `number` no JS; EntitySchema funciona melhor com Bun + ESM do que decorators.
- Dinheiro na borda: sempre `string` com 2 casas. O mapper chama `Money.from` / `toJSON()`. Se o driver devolver `number`, o `Money.from` rejeita (`InvalidMoneyError`).
- Config: `buildMikroOrmConfig(clientUrl)` reutilizável (app + testes de integração futuros). `mikro-orm.config.ts` só lê `DATABASE_URL` e delega.
- Migration 0001: o SQL escrito à mão continua sendo a fonte da verdade. A classe `Migration0001Initial` lê o arquivo e chama `addSql`. O Migrator controla a tabela `mikro_orm_migrations`.
- Alternativa descartada: gerar a migration a partir dos EntitySchemas. O schema já existia e estava validado; reescrever em TypeScript aumentaria o risco de divergência.

## 15. Health

- `GET /health/live`: processo vivo (sempre 200).
- `GET /health/ready`: executa `select 1` no banco; responde 503 se o banco estiver inacessível.
- Autenticação: não será implementada. Documentado aqui e deixado um ponto de extensão no código (guard sem efeito quando as rotas de negócio existirem).