import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Run after prove-document-workspace.mjs; never use live users or business data.
const env = Object.fromEntries(
  readFileSync('.release/rehearsal.env', 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const database = new URL(env.DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '5549');
assert.equal(database.pathname, '/itemba_release_proof');
const fixture = JSON.parse(readFileSync('.release/document-proof/browser-fixture.json', 'utf8'));
assert.match(fixture.email, /^docs-manager-.*@example\.invalid$/);
const base = 'http://127.0.0.1:3114/api/v1';
const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: fixture.email, password: env.RELEASE_PROOF_USER_PASSWORD }),
});
assert.equal(login.status, 200, 'isolated document manager signs in');
const envelope = await login.json();
const token = (envelope.data ?? envelope).accessToken;
assert.ok(token);

const rows = Array.from({ length: 120 }, (_, index) => [
  `ROW-${String(index + 1).padStart(3, '0')}`,
  `Synthetic supplier ${index + 1}`,
  index % 3 === 0
    ? 'Delivery of office supplies, stationery and general materials for the branch. Verify wrapping across multiple lines.'
    : 'Synthetic purchase for pagination verification.',
  ((index + 1) * 1250.25).toFixed(2),
]);
const controlTotal = rows.reduce((sum, row) => sum + Math.round(Number(row[3]) * 100), 0) / 100;
const output = resolve('.release/document-proof/pagination');
mkdirSync(output, { recursive: true });
for (const orientation of ['portrait', 'landscape']) {
  const response = await fetch(`${base}/generated-documents/table-export`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyId: fixture.companyId,
      title: 'Pagination verification',
      subtitle: 'Synthetic release evidence - not a business statement',
      columns: ['Reference', 'Supplier', 'Description', 'Outstanding'],
      rows,
      numericColumns: [3],
      columnWeights: [1, 1.5, 3, 1.2],
      stripedRows: true,
      orientation,
      note: `END-OF-REPORT. 120 entries. Control total TZS ${controlTotal.toFixed(2)}.`,
      format: 'pdf',
    }),
  });
  assert.equal(response.status, 201, `${orientation} table export succeeds`);
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  writeFileSync(resolve(output, `${orientation}.pdf`), buffer);
  console.log(`PASS ${orientation}: authenticated 120-row PDF export (${buffer.length} bytes)`);
}
writeFileSync(
  resolve(output, 'expected.json'),
  JSON.stringify(
    { createdAt: new Date().toISOString(), rows, controlTotal, requiresVisualReview: true },
    null,
    2,
  ),
);
