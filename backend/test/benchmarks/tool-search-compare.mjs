/**
 * Does tool search actually find the right tool?
 *
 * Until this runs, "BM25 beats lexical narrowing" is a design argument. The two
 * paths select tools completely differently, so the only honest comparison is
 * the same questions through both, and a look at which tool each reached for.
 *
 * The flag is read server-side, so this cannot drive both paths in one process:
 *
 *   MSAIDIZI_TOOL_SEARCH=false -> restart backend -> node tool-search-compare.mjs baseline.json
 *   MSAIDIZI_TOOL_SEARCH=true  -> restart backend -> node tool-search-compare.mjs search.json
 *   node tool-search-compare.mjs --diff baseline.json search.json
 *
 * Expectations are RESOLVED AGAINST THE LIVE CAPABILITY LIST rather than
 * hardcoded. A hardcoded tool name that no longer exists makes every case fail
 * as a miss, which reads exactly like the search being bad. Here an unresolvable
 * expectation reports itself as a broken case instead.
 */

import fs from 'node:fs';

const API = process.env.MSAIDIZI_API ?? 'http://127.0.0.1:3014/api/v1';
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!123';

/**
 * `want` is a regex over tool names, matched against the live capability list.
 *
 * The interesting cases are the ones where the user's words share no token with
 * the schema — exactly what lexical overlap cannot bridge and what BM25 is
 * supposed to. The direct ones are controls: if those regress, search is worse
 * rather than differently wrong.
 */
const QUESTIONS = [
  {
    id: 'direct-customers',
    ask: 'How many customers do we have on file?',
    want: /^Customers_/,
    why: 'control - direct vocabulary match',
  },
  {
    id: 'direct-suppliers',
    ask: 'List our suppliers.',
    want: /^Suppliers_/,
    why: 'control - direct vocabulary match',
  },
  {
    id: 'owes-us',
    ask: 'Who owes us money?',
    want: /Receivable/i,
    why: 'vocabulary mismatch - shares no token with "receivables"',
  },
  {
    id: 'we-owe',
    ask: 'What do we owe our suppliers?',
    want: /Payable/i,
    why: 'vocabulary mismatch - shares no token with "payables"',
  },
  {
    id: 'spending',
    ask: 'What did we spend money on recently?',
    want: /Expense/i,
    why: 'near miss - "spend" vs "expenses"',
    first: /Expense/i,
    maxCalls: 2,
  },
  {
    id: 'low-stock',
    ask: 'Which items are running low and need reordering?',
    want: /Stock|Inventory|Product/i,
    why: 'domain phrase with several plausible homes',
  },
  {
    id: 'unpaid-bills',
    ask: 'Are there any bills we have not settled yet?',
    want: /Payable|Bill|SupplierInvoice/i,
    why: 'colloquial phrasing',
  },
];

const requestedCase = process.env.MSAIDIZI_BENCHMARK_CASE?.trim();
const selectedQuestions = requestedCase
  ? QUESTIONS.filter((question) => question.id === requestedCase)
  : QUESTIONS;
if (requestedCase && selectedQuestions.length === 0) {
  throw new Error(`Unknown MSAIDIZI_BENCHMARK_CASE: ${requestedCase}`);
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login failed (${res.status}) - set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD`);
  }
  return (await res.json()).data.accessToken;
}

async function capabilities(token) {
  const res = await fetch(`${API}/msaidizi/capabilities`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`capabilities failed (${res.status})`);
  return (await res.json()).data ?? {};
}

async function ask(token, message) {
  const started = Date.now();
  const res = await fetch(`${API}/msaidizi/ask`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const body = await res.json();
  return { result: body.data ?? body, ms: Date.now() - started, status: res.status };
}

const toolsCalled = (r) =>
  (r.events ?? []).filter((e) => e.type === 'tool_call').map((e) => e.tool);
const answerText = (r) =>
  (r.events ?? [])
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('\n');

// --- diff mode --------------------------------------------------------------

if (process.argv[2] === '--diff') {
  const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  const byId = (r) => Object.fromEntries(r.cases.map((c) => [c.id, c]));
  const A = byId(a);
  const B = byId(b);

  console.log(`\n${'case'.padEnd(18)} ${a.label.padEnd(10)} ${b.label.padEnd(10)} verdict`);
  console.log('-'.repeat(62));

  let better = 0;
  let worse = 0;
  let same = 0;

  for (const id of Object.keys(A)) {
    const x = A[id];
    const y = B[id];
    if (!y) continue;
    const verdict = x.hit === y.hit ? 'same' : y.hit ? 'BETTER' : 'WORSE';
    if (verdict === 'BETTER') better += 1;
    else if (verdict === 'WORSE') worse += 1;
    else same += 1;
    const xs = x.hit ? 'hit' : 'miss';
    const ys = y.hit ? 'hit' : 'miss';
    console.log(`${id.padEnd(18)} ${xs.padEnd(10)} ${ys.padEnd(10)} ${verdict}`);
  }

  const cacheReads = (r) => r.cases.reduce((s, c) => s + (c.usage?.cacheReadInputTokens ?? 0), 0);

  console.log('-'.repeat(62));
  console.log(`better ${better}   worse ${worse}   same ${same}`);
  console.log(`\ncache reads - ${a.label}: ${cacheReads(a)}   ${b.label}: ${cacheReads(b)}`);
  console.log(
    cacheReads(b) > cacheReads(a)
      ? '  Cache is being read on the second path, as a stable tool block predicts.'
      : '  NO cache improvement. If the second path is search, the tool block is not as stable as intended.',
  );

  process.exit(worse > 0 ? 1 : 0);
}

// --- run mode ---------------------------------------------------------------

const out = process.argv[2];
if (!out) {
  console.error('usage: tool-search-compare.mjs <out.json> | --diff <a.json> <b.json>');
  process.exit(2);
}

const token = await login();
const caps = await capabilities(token);
const names = (caps.capabilities ?? []).map((c) => c.name);

console.log(`permitted: ${caps.narrowing?.permitted}   per run: ${caps.narrowing?.perRun}`);
console.log(`narrowing active: ${caps.narrowing?.active}   write mode: ${caps.writeMode}\n`);

const label = process.env.RUN_LABEL ?? (out.includes('search') ? 'search' : 'baseline');
const cases = [];

for (const q of selectedQuestions) {
  // Resolve the expectation before judging, so a stale regex reports itself
  // rather than masquerading as a miss.
  const resolvable = names.filter((n) => q.want.test(n));
  if (resolvable.length === 0) {
    console.log(
      `? ${q.id.padEnd(18)} EXPECTATION UNRESOLVABLE - nothing permitted matches ${q.want}`,
    );
    cases.push({ id: q.id, broken: true, hit: false, want: String(q.want) });
    continue;
  }

  const { result, ms } = await ask(token, q.ask);
  const called = toolsCalled(result);
  const reachedExpected = called.some((t) => q.want.test(t));
  const firstMatched =
    q.first === undefined || (called[0] !== undefined && q.first.test(called[0]));
  const withinCallBudget = q.maxCalls === undefined || called.length <= q.maxCalls;
  const hit = reachedExpected && firstMatched && withinCallBudget;

  cases.push({
    id: q.id,
    why: q.why,
    ask: q.ask,
    want: String(q.want),
    called,
    hit,
    ...(q.first ? { first: String(q.first), firstMatched } : {}),
    ...(q.maxCalls ? { maxCalls: q.maxCalls, withinCallBudget } : {}),
    ms,
    usage: result.usage,
    reason: result.reason,
    answer: answerText(result).slice(0, 300),
  });

  console.log(
    `${hit ? '+' : '-'} ${q.id.padEnd(18)} ${String(ms).padStart(6)}ms  ${called.join(', ') || '(no tools)'}`,
  );
  if (!hit) {
    console.log(`    wanted ${q.want} - ${q.why}`);
    if (!firstMatched) console.log(`    first call must match ${q.first}`);
    if (!withinCallBudget) console.log(`    call budget ${q.maxCalls}, observed ${called.length}`);
  }
}

fs.writeFileSync(
  out,
  JSON.stringify({ label, at: new Date().toISOString(), caps: caps.narrowing, cases }, null, 2),
);

const hits = cases.filter((c) => c.hit).length;
console.log(`\n${label}: ${hits}/${cases.length} reached the expected tool  ->  ${out}`);
// A benchmark that only prints misses is documentation, not a regression gate.
// This includes the spending trace requirements because that case's `hit`
// already requires Expenses first and no more than two dispatched tools.
if (hits !== cases.length) process.exitCode = 1;
