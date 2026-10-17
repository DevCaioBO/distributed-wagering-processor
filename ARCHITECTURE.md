# ARCHITECTURE

Decisões tomadas até agora. As seções de concorrência, idempotência e mensageria serão escritas quando forem implementadas.

## 1. Bun no lugar do vitest

- Escolha: testes com `bun test`, imports de `bun:test`.
- Contexto: o `nest new` junta sistema de módulos e test runner numa pergunta só (ESM com vitest). O desafio exige Bun como test runner, então o vitest foi removido depois do scaffold, junto com seus arquivos de config e dependências, e os scripts de teste passaram a chamar `bun test`.
- Por quê: é exigência do desafio, e um runtime só evita diferença entre rodar e testar.
- Custo: ecossistema de testes menor e API de mock diferente da do Jest e do vitest.

## 2. Domínio sem framework

- Escolha: as classes de domínio não importam NestJS nem ORM. Construtor privado e factories estáticas (`from`, `create`, `rehydrate`).
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