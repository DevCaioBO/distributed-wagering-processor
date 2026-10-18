const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PG_USER = process.env.POSTGRES_USER ?? 'wagering';
const PG_DB = process.env.POSTGRES_DB ?? 'wagering';
const PROVIDER = 'provider-demo';
const RUN = Date.now().toString(36);
 
let failures = 0;
let warnings = 0;
let counter = 0;
 
interface HttpResult {
  status: number;
  body: any;
}
 
async function http(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}
 
function sql(query: string): string | undefined {
  const result = Bun.spawnSync([
    'docker', 'compose', 'exec', '-T', 'postgres',
    'psql', '-U', PG_USER, '-d', PG_DB, '-tA', '-c', query,
  ]);
  if (result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout.toString().trim();
}
 
function title(text: string): void {
  console.log(`\n=== ${text} ===`);
}
 
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `  -> ${detail}` : ''}`);
  }
}
 
function warn(name: string, detail = ''): void {
  warnings += 1;
  console.log(`  WARN  ${name}${detail ? `  -> ${detail}` : ''}`);
}
 
function amountOf(balance: unknown): string | undefined {
  if (typeof balance === 'string') {
    return balance;
  }
  if (balance !== null && typeof balance === 'object' && 'amount' in balance) {
    return String((balance as { amount: unknown }).amount);
  }
  return undefined;
}
 
async function createWallet(label: string, amount: string): Promise<{ id: string; playerId: string }> {
  counter += 1;
  const playerId = `demo-${RUN}-${label}-${counter}`;
  const res = await http('POST', '/wallets', {
    playerId,
    initialBalance: { amount, currency: 'BRL' },
  });
  if (res.status >= 300 || typeof res.body?.id !== 'string') {
    throw new Error(`falha ao criar wallet (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.id, playerId };
}
 
async function balanceOf(walletId: string): Promise<string | undefined> {
  const res = await http('GET', `/wallets/${walletId}`);
  return amountOf(res.body?.balance);
}
 
interface SubmitOptions {
  walletId: string;
  playerId: string;
  kind: string;
  amount: string;
  external?: string;
  key?: string;
  reference?: string;
  currency?: string;
  withKey?: boolean;
}
 
async function submit(options: SubmitOptions): Promise<HttpResult & { external: string; key: string }> {
  counter += 1;
  const external = options.external ?? `${RUN}-tx-${counter}`;
  const key = options.key ?? `${PROVIDER}:${external}`;
  const payload: Record<string, unknown> = {
    providerId: PROVIDER,
    externalTransactionId: external,
    playerId: options.playerId,
    walletId: options.walletId,
    roundId: `round-${RUN}`,
    gameId: 'game-demo',
    kind: options.kind,
    money: { amount: options.amount, currency: options.currency ?? 'BRL' },
  };
  if (options.reference !== undefined) {
    payload.referenceExternalTransactionId = options.reference;
  }
  const headers: Record<string, string> = options.withKey === false ? {} : { 'Idempotency-Key': key };
  const res = await http('POST', '/wager-transactions', payload, headers);
  return { ...res, external, key };
}
 
function ledgerCount(walletId: string, direction?: string): number | undefined {
  const filter = direction === undefined ? '' : ` and direction = '${direction}'`;
  const out = sql(`select count(*) from wallet_ledger_entries where wallet_id = '${walletId}'${filter}`);
  return out === undefined ? undefined : Number.parseInt(out, 10);
}
 
async function waitFor(fn: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return true;
    }
    await Bun.sleep(1000);
  }
  return false;
}
 
async function main(): Promise<void> {
  const live = await http('GET', '/health/live').catch(() => undefined);
  if (live === undefined || live.status !== 200) {
    console.log(`API não respondeu em ${BASE}. Suba com: bun run start:dev`);
    process.exit(1);
  }
  if (sql('select 1') === undefined) {
    console.log('Sem acesso ao Postgres via docker compose. Rode a partir da raiz do projeto, com os containers de pé.');
    process.exit(1);
  }
 
  title('1. Abertura de wallet (OPENING + ledger)');
  const w1 = await createWallet('open', '100.00');
  check('saldo inicial 100.00', (await balanceOf(w1.id)) === '100.00');
  check(
    'transação OPENING do provedor system, PROCESSED',
    sql(`select kind || '/' || status || '/' || provider_id from wager_transactions where wallet_id = '${w1.id}'`) ===
      'OPENING/PROCESSED/system',
  );
  check('1 lançamento CREDIT de 100.00 (antes 0.00, depois 100.00)',
    sql(`select direction || '/' || amount || '/' || balance_before || '/' || balance_after from wallet_ledger_entries where wallet_id = '${w1.id}'`) ===
      'CREDIT/100.00/0.00/100.00');
  const dup = await http('POST', '/wallets', {
    playerId: w1.playerId,
    initialBalance: { amount: '1.00', currency: 'BRL' },
  });
  check('mesma wallet (playerId + moeda) de novo dá 409', dup.status === 409, `status ${dup.status}`);
 
  title('2. Aposta, resultado e idempotência');
  const bet = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'BET', amount: '25.00' });
  check('BET 25.00 -> 200 PROCESSED', bet.status === 200 && bet.body?.status === 'PROCESSED', `${bet.status} ${JSON.stringify(bet.body)}`);
  check('saldo 75.00 e idempotentReplay false', amountOf(bet.body?.balance) === '75.00' && bet.body?.idempotentReplay === false);
  const replay = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'BET', amount: '25.00', external: bet.external, key: bet.key });
  check('replay idêntico -> mesma transação e idempotentReplay true',
    replay.status === 200 && replay.body?.transactionId === bet.body?.transactionId && replay.body?.idempotentReplay === true,
    `${replay.status} ${JSON.stringify(replay.body)}`);
  check('replay devolve o saldo original (75.00)', amountOf(replay.body?.balance) === '75.00');
  check('continua 1 só débito no ledger', ledgerCount(w1.id, 'DEBIT') === 1, `débitos: ${ledgerCount(w1.id, 'DEBIT')}`);
  const conflict = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'BET', amount: '26.00', external: bet.external, key: bet.key });
  check('mesma key com valor diferente -> 409 (conflito, não replay)', conflict.status === 409, `status ${conflict.status}`);
  const noKey = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'BET', amount: '1.00', withKey: false });
  check('sem header Idempotency-Key -> 400', noKey.status === 400, `status ${noKey.status}`);
 
  const win = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'WIN', amount: '40.00' });
  check('WIN 40.00 -> saldo 115.00', win.status === 200 && amountOf(win.body?.balance) === '115.00', JSON.stringify(win.body));
  const entriesBeforeLoss = ledgerCount(w1.id);
  const loss = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'LOSS', amount: '10.00' });
  check('LOSS -> PROCESSED, saldo inalterado (115.00)', loss.status === 200 && amountOf(loss.body?.balance) === '115.00', JSON.stringify(loss.body));
  check('LOSS não gera lançamento no ledger', ledgerCount(w1.id) === entriesBeforeLoss);
  const tooBig = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'BET', amount: '500.00' });
  check('BET maior que o saldo -> 422 INSUFFICIENT_FUNDS',
    tooBig.status === 422 && tooBig.body?.failureCode === 'INSUFFICIENT_FUNDS', `${tooBig.status} ${JSON.stringify(tooBig.body)}`);
  check('rejeição não muda o saldo (115.00)', (await balanceOf(w1.id)) === '115.00');
 
  title('3. Reversões (REFUND e ROLLBACK)');
  const refundTarget = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'BET', amount: '15.00' });
  const refund = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'REFUND', amount: '15.00', reference: refundTarget.external });
  check('REFUND da BET -> PROCESSED e saldo volta a 115.00', refund.status === 200 && amountOf(refund.body?.balance) === '115.00', JSON.stringify(refund.body));
  const refundAgain = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'REFUND', amount: '15.00', reference: refundTarget.external });
  check('segundo REFUND da mesma BET -> 422 ALREADY_REVERSED',
    refundAgain.status === 422 && refundAgain.body?.failureCode === 'ALREADY_REVERSED', `${refundAgain.status} ${JSON.stringify(refundAgain.body)}`);
  const refundTarget2 = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'BET', amount: '5.00' });
  const wrongAmount = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'REFUND', amount: '4.00', reference: refundTarget2.external });
  check('REFUND com valor diferente -> 422 AMOUNT_MISMATCH',
    wrongAmount.status === 422 && wrongAmount.body?.failureCode === 'AMOUNT_MISMATCH', `${wrongAmount.status} ${JSON.stringify(wrongAmount.body)}`);
  const winForRollback = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'WIN', amount: '30.00' });
  const balanceBeforeRollback = await balanceOf(w1.id);
  const rollback = await submit({ walletId: w1.id, playerId: w1.playerId, kind: 'ROLLBACK', amount: '30.00', reference: winForRollback.external });
  check('ROLLBACK de uma WIN gera DÉBITO (saldo cai 30.00)',
    rollback.status === 200 && Number(amountOf(rollback.body?.balance)) === Number(balanceBeforeRollback) - 30,
    `${rollback.status} ${JSON.stringify(rollback.body)}`);
 
  title('4. Cenário obrigatório: saldo 100.00 e duas apostas de 80.00 ao mesmo tempo');
  const w2 = await createWallet('race', '100.00');
  const [r1, r2] = await Promise.all([
    submit({ walletId: w2.id, playerId: w2.playerId, kind: 'BET', amount: '80.00' }),
    submit({ walletId: w2.id, playerId: w2.playerId, kind: 'BET', amount: '80.00' }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  check('exatamente uma PROCESSED (200) e uma REJECTED (422)', statuses[0] === 200 && statuses[1] === 422, `status: ${statuses.join(', ')}`);
  const rejected = [r1, r2].find((r) => r.status === 422);
  check('a rejeitada é INSUFFICIENT_FUNDS', rejected?.body?.failureCode === 'INSUFFICIENT_FUNDS', JSON.stringify(rejected?.body));
  check('saldo final 20.00', (await balanceOf(w2.id)) === '20.00');
  check('exatamente 1 lançamento de débito', ledgerCount(w2.id, 'DEBIT') === 1, `débitos: ${ledgerCount(w2.id, 'DEBIT')}`);
 
  title('5. A mesma aposta 50 vezes em paralelo');
  const w3 = await createWallet('dup50', '100.00');
  const external50 = `${RUN}-same-50`;
  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      submit({ walletId: w3.id, playerId: w3.playerId, kind: 'BET', amount: '10.00', external: external50 }),
    ),
  );
  const okAll = results.every((r) => r.status === 200);
  const firsts = results.filter((r) => r.body?.idempotentReplay === false).length;
  const ids = new Set(results.map((r) => r.body?.transactionId));
  check('as 50 respostas são 200', okAll, `status: ${[...new Set(results.map((r) => r.status))].join(', ')}`);
  check('só 1 resposta com idempotentReplay false', firsts === 1, `encontrou ${firsts}`);
  check('todas devolvem o mesmo transactionId', ids.size === 1, `ids distintos: ${ids.size}`);
  check('saldo 90.00 e 1 só débito', (await balanceOf(w3.id)) === '90.00' && ledgerCount(w3.id, 'DEBIT') === 1);
 
  title('6. Wallets diferentes em paralelo');
  const many = await Promise.all(Array.from({ length: 10 }, (_, i) => createWallet(`par${i}`, '100.00')));
  const parallel = await Promise.all(
    many.map((w) => submit({ walletId: w.id, playerId: w.playerId, kind: 'BET', amount: '10.00' })),
  );
  check('as 10 apostas deram 200', parallel.every((r) => r.status === 200));
  const balances = await Promise.all(many.map((w) => balanceOf(w.id)));
  check('todas as 10 wallets ficaram com 90.00', balances.every((b) => b === '90.00'), balances.join(', '));
 
  title('7. Referência fora de ordem');
  const w4 = await createWallet('order', '100.00');
  const betExternal = `${RUN}-late-bet`;
  const early = await submit({ walletId: w4.id, playerId: w4.playerId, kind: 'REFUND', amount: '20.00', reference: betExternal });
  check('REFUND antes da BET -> 202 PENDING_REFERENCE', early.status === 202 && early.body?.status === 'PENDING_REFERENCE', `${early.status} ${JSON.stringify(early.body)}`);
  check('saldo continua 100.00', (await balanceOf(w4.id)) === '100.00');
  await submit({ walletId: w4.id, playerId: w4.playerId, kind: 'BET', amount: '20.00', external: betExternal });
  const resolved = await waitFor(async () => {
    const res = await http('GET', `/wager-transactions?providerId=${PROVIDER}&externalTransactionId=${early.external}`);
    return res.body?.status === 'PROCESSED';
  }, 45000);
  if (resolved) {
    check('worker reprocessou o REFUND sozinho -> PROCESSED', true);
    check('saldo final 100.00 (aposta de 20.00 devolvida)', (await balanceOf(w4.id)) === '100.00');
  } else {
    warn('REFUND continuou pendente por 45s', 'o worker de PENDING_REFERENCE pode não estar iniciado');
  }
 
  title('8. Consultas');
  const byId = await http('GET', `/wager-transactions/${bet.body?.transactionId}`);
  check('GET /wager-transactions/:id', byId.status === 200 && byId.body?.status === 'PROCESSED');
  const byExternal = await http('GET', `/wager-transactions?providerId=${PROVIDER}&externalTransactionId=${bet.external}`);
  check('GET por (providerId, externalTransactionId) é a mesma transação', byExternal.body?.id === bet.body?.transactionId);
  const ledger = await http('GET', `/wallets/${w1.id}/ledger?limit=2`);
  check('GET /wallets/:id/ledger?limit=2 responde 200', ledger.status === 200, `status ${ledger.status}`);
  console.log(`        resposta do ledger: ${JSON.stringify(ledger.body).slice(0, 220)}`);
  const reconcile = await http('GET', `/wallets/${w1.id}/reconcile`);
  check('reconciliação responde 200', reconcile.status === 200, `status ${reconcile.status}`);
  console.log(`        resposta da reconciliação: ${JSON.stringify(reconcile.body)}`);
  if (typeof reconcile.body?.consistent === 'boolean') {
    check('reconciliação consistente', reconcile.body.consistent === true);
  }
 
  title('9. Outbox (eventos)');
  const typesOut = sql('select event_type || \': \' || count(*) from outbox_messages group by event_type order by 1');
  console.log(`        eventos gravados:\n${(typesOut ?? '').split('\n').map((l) => `          ${l}`).join('\n')}`);
  const drained = await waitFor(async () => sql('select count(*) from outbox_messages where published_at is null') === '0', 20000);
  if (drained) {
    check('todos os eventos foram publicados (published_at preenchido)', true);
  } else {
    warn('ainda há eventos pendentes na outbox depois de 20s', 'o publisher pode não estar iniciado');
  }
 
  title('10. Invariantes finais (ground truth no banco)');
  const diverging = sql(`
    select count(*) from (
      select w.id
      from wallets w
      left join wallet_ledger_entries l on l.wallet_id = w.id
      group by w.id, w.balance
      having w.balance <> coalesce(sum(case when l.direction = 'CREDIT' then l.amount else -l.amount end), 0)
    ) t`);
  check('saldo de toda wallet == saldo reconstruído pelo ledger', diverging === '0', `wallets divergentes: ${diverging}`);
  check('nenhuma transação com mais de um lançamento na mesma wallet',
    sql('select count(*) from (select wallet_id, transaction_id from wallet_ledger_entries group by 1, 2 having count(*) > 1) t') === '0');
  check('nenhuma wallet com saldo negativo', sql('select count(*) from wallets where balance < 0') === '0');
  check('nenhuma transação duplicada por (provedor, key)',
    sql('select count(*) from (select provider_id, idempotency_key from wager_transactions group by 1, 2 having count(*) > 1) t') === '0');
 
  console.log(`\nResultado: ${failures === 0 ? 'TUDO OK' : `${failures} falha(s)`}${warnings > 0 ? `, ${warnings} aviso(s)` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
 
main().catch((error) => {
  console.error(error);
  process.exit(1);
});