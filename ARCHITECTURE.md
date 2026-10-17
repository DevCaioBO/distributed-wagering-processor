# ARCHITECTURE

Decisões tomadas até agora. As seções de concorrência, idempotência e mensageria serão escritas quando forem implementadas.

## 1. Bun no lugar do vitest

- Escolha: testes com `bun test`, imports de `bun:test`.
- Contexto: o `nest new` junta sistema de módulos e test runner numa pergunta só (ESM com vitest). O desafio exige Bun como test runner, então o vitest foi removido depois do scaffold, junto com seus arquivos de config e dependências, e os scripts de teste passaram a chamar `bun test`.
- Por quê: é exigência do desafio, e um runtime só evita diferença entre rodar e testar.
- Custo: ecossistema de testes menor e API de mock diferente da do Jest e do vitest.

## 2. Domínio sem framework

- Escolha: as classes de domínio não importam NestJS nem ORM. Construtor privado e factories estáticas (`from`, `create`, `open`, `rehydrate`).
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
- Saldo negativo é rejeitado. No banco isso vai virar uma constraint também.
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
PENDING            -> PENDING_REFERENCE | PROCESSED | REJECTED | FAILED
PENDING_REFERENCE  -> PENDING_REFERENCE | PROCESSED | REJECTED | FAILED
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
- `OPENING` é rejeitado em `create`, porque é um tipo interno que não pode vir da API nem da fila. Falta uma factory interna para a transação de abertura da wallet, que será desenhada junto com a persistência (a transação de abertura não tem provedor nem idempotency key reais).

### Direção do lançamento

- `BET` debita. `WIN`, `REFUND` e `OPENING` creditam. `LOSS` não tem direção e lança erro.
- `ROLLBACK` é o inverso da referência: reverter uma `BET` credita, reverter uma `WIN` ou um `REFUND` debita. Reverter outro `ROLLBACK` ou uma `LOSS` é erro.

### Validação da referência

- `validateReference(reference)` devolve um `FailureCode` ou `undefined`. Confere, nessa ordem: id externo, provedor, jogador, wallet, rodada e moeda iguais (`REFERENCE_MISMATCH`); tipo permitido (`INVALID_REFERENCE_KIND`); e, em `REFUND` e `ROLLBACK`, valor igual ao da referência (`AMOUNT_MISMATCH`).
- Tipos permitidos: `REFUND` referencia só `BET`. `ROLLBACK` referencia `BET`, `WIN` ou `REFUND`. `WIN` e `LOSS` referenciam só `BET`.
- O que fica de fora, de propósito, porque depende do banco e será do use case: a referência estar `PROCESSED`, a reversão única (uma referência não pode ser revertida duas vezes pelo mesmo tipo) e saldo negativo causado pela reversão.
- Por quê: o domínio decide o que dá para decidir olhando só dois objetos, e devolve um código em vez de lançar, para o use case poder gravar a rejeição de forma auditável.

## 7. Códigos de falha (`FailureCode`)

O provedor precisa decidir sozinho se reenvia, corrige o payload ou desiste. Por isso cada código tem uma ação (`providerActionFor`), e o compilador obriga a definir a ação de todo código novo.

| Código | Situação | O provedor deve |
| --- | --- | --- |
| `INSUFFICIENT_FUNDS` | `BET` sem saldo | desistir |
| `REVERSAL_WOULD_OVERDRAW` | reversão deixaria o saldo negativo | falar com o suporte |
| `REFERENCE_NOT_FOUND` | a referência não chegou dentro do limite de tentativas | corrigir a referência ou reenviar a original |
| `REFERENCE_MISMATCH` | referência de outro provedor, jogador, wallet, rodada ou moeda | corrigir o payload |
| `INVALID_REFERENCE_KIND` | tipo de referência não permitido | corrigir o payload |
| `REFERENCE_NOT_PROCESSED` | a referência existe, mas foi rejeitada ou falhou | desistir |
| `ALREADY_REVERSED` | a referência já foi revertida | desistir |
| `AMOUNT_MISMATCH` | valor da reversão diferente do da referência | corrigir o payload |
| `CURRENCY_MISMATCH` | moeda diferente da da wallet | corrigir o payload |
| `WALLET_NOT_FOUND` | wallet inexistente | corrigir o payload |
| `WALLET_PLAYER_MISMATCH` | a wallet não pertence ao jogador informado | corrigir o payload |
| `PROCESSING_FAILED` | erro permanente de infraestrutura | falar com o suporte |

- Saldo insuficiente em aposta e reversão que estoura o saldo têm códigos e ações diferentes, como o README pede: na primeira o provedor não pode fazer nada, e a segunda é uma situação operacional que alguém precisa olhar.
- Falhas transitórias (banco fora do ar, por exemplo) não viram `FailureCode`. Elas não são gravadas como estado terminal: a operação é repetida, e só um erro permanente vira `FAILED`.
- Alguns códigos só passam a ser usados quando o use case existir (`WALLET_NOT_FOUND`, `ALREADY_REVERSED`, `REVERSAL_WOULD_OVERDRAW`, `REFERENCE_NOT_PROCESSED`, `CURRENCY_MISMATCH`, `WALLET_PLAYER_MISMATCH`). Estão no enum para a taxonomia já ficar completa e documentada.

## 8. Múltiplos provedores

O provedor é só uma identidade (`providerId`). Não há lógica por provedor no domínio. O que muda nas próximas fases:

- unicidade por provedor no banco: `(provider_id, external_transaction_id)` e `(provider_id, idempotency_key)`;
- a referência de `REFUND` e `ROLLBACK` resolve por `(providerId, referenceExternalTransactionId)`, então um provedor nunca reverte transação de outro. O domínio já confere isso em `validateReference`.

## 9. Estratégia de testes

- Domínio: testes unitários com `bun test`, sem banco e sem fila. Não há infraestrutura para substituir, então não há mock.
- Integração e concorrência (a partir da persistência): PostgreSQL e SQS reais em containers, com paralelismo real. O desafio elimina soluções que substituem PostgreSQL e SQS por mocks.
- O tempo é passado como parâmetro (`now`, `at`, `createdAt`), o que deixa os testes determinísticos.