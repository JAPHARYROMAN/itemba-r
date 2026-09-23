import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(root, '.release/rehearsal.env'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const recovery = JSON.parse(readFileSync(resolve(root, '.release/recovery.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(resolve(root, '.release/browser-fixture.json'), 'utf8'));
const database = new URL(env.DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '5549');
assert.equal(database.pathname, '/itemba_release_proof');
assert.match(recovery.restoredDatabase, /^itemba_release_restore_\d+$/);
assert.equal(recovery.contentVerified, true);
database.pathname = '/' + recovery.restoredDatabase;
const out = openSync(resolve(root, '.release/restored-api.out.log'), 'w');
const err = openSync(resolve(root, '.release/restored-api.err.log'), 'w');
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: resolve(root, 'backend'),
  env: { ...process.env, ...env, DATABASE_URL: database.href, PORT: '3115' },
  windowsHide: true,
  stdio: ['ignore', out, err],
});
closeSync(out);
closeSync(err);
const start = Date.now();
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('Restored API exited during startup.');
    try {
      ready =
        (
          await fetch('http://127.0.0.1:3115/api/v1/health/ready', {
            signal: AbortSignal.timeout(1000),
          })
        ).status === 200;
    } catch {}
    if (ready) break;
    await setTimeout(500);
  }
  assert.ok(ready, 'Restored API did not become ready.');
  const login = await fetch('http://127.0.0.1:3115/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: fixture.email, password: env.RELEASE_PROOF_USER_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const response = await login.json(),
    token = (response.data ?? response).accessToken;
  assert.ok(token, 'Restored sign-in did not return an access token.');
  const invoiceResponse = await fetch(
    `http://127.0.0.1:3115/api/v1/invoice-desk/invoices/${fixture.invoiceId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(invoiceResponse.status, 200);
  const invoiceJson = await invoiceResponse.json(),
    invoice = invoiceJson.data ?? invoiceJson;
  assert.equal(Number(invoice.paidAmount), 1200);
  const salesResponse = await fetch(
    'http://127.0.0.1:3115/api/v1/desk-reports/sales?from=2026-09-01&to=2026-09-30',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(salesResponse.status, 200);
  const salesJson = await salesResponse.json(),
    sales = salesJson.data ?? salesJson;
  assert.equal(Number(sales.tables.find((t) => t.id === 'parties').rows[0].closing), 0);
  const result = {
    createdAt: new Date().toISOString(),
    database: recovery.restoredDatabase,
    apiReady: true,
    restoredLogin: true,
    paidInvoicePreserved: true,
    salesReportPreserved: true,
    startAndCheckSeconds: (Date.now() - start) / 1000,
    limits:
      'Side-by-side local restore validation. No production traffic, DNS, object storage or older application image was switched.',
  };
  writeFileSync(resolve(root, '.release/cutover.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  child.kill();
}
