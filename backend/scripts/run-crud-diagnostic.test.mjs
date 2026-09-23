import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnosticSchema, diagnosticTarget } from './run-crud-diagnostic.mjs';

test('generated schema names fit PostgreSQL identifiers without truncation', () => {
  const schemas = Array.from({ length: 100 }, diagnosticSchema);
  assert.equal(new Set(schemas).size, 100);
  for (const schema of schemas) {
    assert.match(schema, /^msaidizi_crud_evidence_diag_[a-f0-9]{32}$/);
    assert.ok(Buffer.byteLength(schema) <= 63);
  }
});

const valid = {
  DATABASE_URL: 'postgresql://proof@127.0.0.1:55440/msaidizi_crud_diagnostic_test',
  CRUD_COVERAGE_DISPOSABLE_DATABASE_ACK: '127.0.0.1:55440/msaidizi_crud_diagnostic_test',
};
test('admits only the explicitly acknowledged loopback diagnostic database', () => {
  assert.equal(diagnosticTarget(valid).pathname, '/msaidizi_crud_diagnostic_test');
});
for (const url of [
  'postgresql://proof@remote:55440/msaidizi_crud_diagnostic_test',
  'postgresql://proof@127.0.0.1:55440/itemba',
  `${valid.DATABASE_URL}?schema=public`,
  `${valid.DATABASE_URL}?host=remote`,
  `${valid.DATABASE_URL}#fragment`,
  'https://127.0.0.1/msaidizi_crud_diagnostic_test',
]) {
  test(`refuses unsafe target: ${url}`, () =>
    assert.throws(() => diagnosticTarget({ ...valid, DATABASE_URL: url })));
}
test('refuses a missing acknowledgement', () =>
  assert.throws(() => diagnosticTarget({ DATABASE_URL: valid.DATABASE_URL })));
