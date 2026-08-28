import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  CRUD_EVIDENCE_ACCESS_TOKEN_TTL,
  CRUD_EVIDENCE_MAX_CASE_ASSERTIONS,
  executionBundleDigest,
  prismaSchemaMigrationDigest,
  sanitizedEvidenceChildEnvironment,
  validateUnsignedCrudPayload,
} from './crud-evidence-runner-lib.mjs';

const runner = resolve(import.meta.dirname, 'run-crud-evidence.mjs');

test('refuses to overwrite or summarize a pre-existing evidence artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'crud-evidence-runner-'));
  try {
    const privateKey = join(root, 'private.pem');
    const output = join(root, 'evidence.json');
    const sentinel = '{"artifact":"belongs-to-an-earlier-run"}\n';
    writeFileSync(privateKey, 'deliberately-unused-test-key\n');
    writeFileSync(output, sentinel);

    const result = spawnSync(process.execPath, [runner], {
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://itemba@127.0.0.1:5432/disposable_test',
        CRUD_COVERAGE_DISPOSABLE_DATABASE_ACK: '127.0.0.1:5432/disposable_test',
        MSAIDIZI_CRUD_EVIDENCE_PRIVATE_KEY_PATH: privateKey,
        MSAIDIZI_CRUD_EVIDENCE_OUTPUT_PATH: output,
        MSAIDIZI_CRUD_EVIDENCE_SIGNING_KEY_ID: 'runner-test-key',
        MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST: 'a'.repeat(64),
      },
      encoding: 'utf8',
      windowsHide: true,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /output path already exists and will not be overwritten/i);
    assert.equal(readFileSync(output, 'utf8'), sentinel);
    assert.doesNotMatch(result.stdout, /Positive fixtures:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('never creates a release artifact when preflight fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'crud-evidence-runner-'));
  try {
    const privateKey = join(root, 'private.pem');
    const output = join(root, 'evidence.json');
    writeFileSync(privateKey, 'deliberately-unused-test-key\n');

    const result = spawnSync(process.execPath, [runner], {
      env: {
        ...process.env,
        DATABASE_URL: 'not-a-postgresql-url',
        CRUD_COVERAGE_DISPOSABLE_DATABASE_ACK: '127.0.0.1/disposable_test',
        MSAIDIZI_CRUD_EVIDENCE_PRIVATE_KEY_PATH: privateKey,
        MSAIDIZI_CRUD_EVIDENCE_OUTPUT_PATH: output,
        MSAIDIZI_CRUD_EVIDENCE_SIGNING_KEY_ID: 'runner-test-key',
        MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST: 'a'.repeat(64),
      },
      encoding: 'utf8',
      windowsHide: true,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DATABASE_URL must be a valid PostgreSQL URL/i);
    assert.throws(() => readFileSync(output), /ENOENT/);
    assert.doesNotMatch(result.stdout, /Positive fixtures:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scrubs every evidence signing and release-output handle from the Jest child', () => {
  const child = sanitizedEvidenceChildEnvironment(
    {
      PATH: 'kept',
      ANTHROPIC_API_KEY: 'must-not-reach-loopback-child',
      MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH: 'C:\\legal-evidence.json',
      MSAIDIZI_CRUD_EVIDENCE_PRIVATE_KEY_PATH: 'C:\\secret.pem',
      msaidizi_crud_evidence_signing_key_id: 'secret-key-id',
      MSAIDIZI_CRUD_EVIDENCE_OUTPUT_PATH: 'C:\\release.json',
      CRUD_COVERAGE_EVIDENCE_KEY_ID: 'legacy-secret-key-id',
      CRUD_EVIDENCE_PRIVATE_SIGNING_KEY_ALIAS: 'also-secret',
      JWT_ACCESS_EXPIRES_IN: '1s',
      JOB_WORKER_ENABLED: 'true',
      AUTOMATION_DISPATCH_ENABLED: 'true',
      MSAIDIZI_GLOBAL_KILL_SWITCH: 'true',
      MSAIDIZI_DEVICE_PAIRING_ENABLED: 'true',
      MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED: 'true',
      JWT_ACCESS_EXPIRES_IN: '5s',
    },
    {
      CRUD_COVERAGE_UNSIGNED_OUTPUT_PATH: 'C:\\unsigned.json',
      MSAIDIZI_ENABLED: 'true',
      MSAIDIZI_HOST_EXECUTION_ENABLED: 'true',
      JOB_WORKER_ENABLED: 'true',
      AUTOMATION_DISPATCH_ENABLED: 'true',
      MSAIDIZI_GLOBAL_KILL_SWITCH: 'true',
      MSAIDIZI_DEVICE_PAIRING_ENABLED: 'true',
      MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
      MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED: 'true',
      MSAIDIZI_UPDATE_SUPERVISOR_ENABLED: 'true',
      MSAIDIZI_RECOVERY_SUPERVISOR_ENABLED: 'true',
      MSAIDIZI_AUDIT_SIGNER_ENABLED: 'true',
      MSAIDIZI_EVALUATOR_MTLS_ENABLED: 'true',
    },
  );

  assert.deepEqual(child, {
    PATH: 'kept',
    CRUD_COVERAGE_UNSIGNED_OUTPUT_PATH: 'C:\\unsigned.json',
    JWT_ACCESS_EXPIRES_IN: CRUD_EVIDENCE_ACCESS_TOKEN_TTL,
    MSAIDIZI_ENABLED: 'false',
    MSAIDIZI_AUTONOMY_ENABLED: 'false',
    MSAIDIZI_AUTOPILOT_ENABLED: 'false',
    MSAIDIZI_HOST_EXECUTION_ENABLED: 'false',
    MSAIDIZI_ADAPTIVE_REASONING_ENABLED: 'false',
    MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'false',
    MSAIDIZI_TASK_WORKER_ENABLED: 'false',
    MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'false',
    MSAIDIZI_DEVICE_PAIRING_ENABLED: 'false',
    MSAIDIZI_DIRECT_MTLS_ENABLED: 'false',
    MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED: 'false',
    MSAIDIZI_UPDATE_SUPERVISOR_ENABLED: 'false',
    MSAIDIZI_RECOVERY_SUPERVISOR_ENABLED: 'false',
    MSAIDIZI_AUDIT_SIGNER_ENABLED: 'false',
    MSAIDIZI_EVALUATOR_MTLS_ENABLED: 'false',
    MSAIDIZI_GLOBAL_KILL_SWITCH: 'false',
    JOB_WORKER_ENABLED: 'false',
    AUTOMATION_DISPATCH_ENABLED: 'false',
  });
});

test('parent accepts only a closed successful payload bound to its own run facts', () => {
  const now = Date.parse('2026-08-25T12:00:00.000Z');
  const expected = {
    applicationBuildDigest: 'a'.repeat(64),
    prismaSchemaMigrationDigest: 'b'.repeat(64),
    isolatedSchemaNameDigest: 'c'.repeat(64),
    runStartedAtMs: now - 1_000,
    runFinishedAtMs: now + 1_000,
  };
  const good = payload(now, expected);
  assert.equal(validateUnsignedCrudPayload(good, expected), good);

  assert.throws(
    () =>
      validateUnsignedCrudPayload(
        {
          ...good,
          provenance: { ...good.provenance, prismaSchemaMigrationDigest: 'd'.repeat(64) },
        },
        expected,
      ),
    /parent-computed Prisma tree/,
  );
  assert.throws(
    () => validateUnsignedCrudPayload({ ...good, unexpected: true }, expected),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      validateUnsignedCrudPayload(
        { ...good, cases: [{ ...good.cases[0], outcome: 'failed' }] },
        expected,
      ),
    /failed case/,
  );
  assert.throws(
    () =>
      validateUnsignedCrudPayload(
        { ...good, cases: [{ ...good.cases[0], assertions: [{ name: 'forged', passed: false }] }] },
        expected,
      ),
    /malformed or failed assertion/,
  );
});

test('accepts the bounded compound-proof size and names an oversized case exactly', () => {
  const now = Date.parse('2026-08-25T12:00:00.000Z');
  const expected = {
    applicationBuildDigest: 'a'.repeat(64),
    prismaSchemaMigrationDigest: 'b'.repeat(64),
    isolatedSchemaNameDigest: 'c'.repeat(64),
    runStartedAtMs: now - 1_000,
    runFinishedAtMs: now + 1_000,
  };
  const good = payload(now, expected);
  const assertions = Array.from({ length: CRUD_EVIDENCE_MAX_CASE_ASSERTIONS }, (_, index) => ({
    name: `independent compound assertion ${index + 1}`,
    passed: true,
  }));
  const bounded = { ...good, cases: [{ ...good.cases[0], assertions }] };

  assert.equal(validateUnsignedCrudPayload(bounded, expected), bounded);

  const oversized = {
    ...good,
    cases: [
      {
        ...good.cases[0],
        assertions: [
          ...assertions,
          { name: 'one assertion beyond the signed envelope', passed: true },
        ],
      },
    ],
  };
  assert.throws(
    () => validateUnsignedCrudPayload(oversized, expected),
    new RegExp(
      `customer-list-positive has ${CRUD_EVIDENCE_MAX_CASE_ASSERTIONS + 1} assertions; maximum is ${CRUD_EVIDENCE_MAX_CASE_ASSERTIONS}`,
    ),
  );
});

test('execution bundle digest includes installed runtime and native engine bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'crud-evidence-bundle-'));
  try {
    for (const directory of ['src', 'test', 'node_modules/.prisma/client']) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    for (const file of [
      'package.json',
      'package-lock.json',
      'nest-cli.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'src/app.ts',
      'test/harness.ts',
      'node_modules/runtime.js',
      'node_modules/.prisma/client/query_engine-test.node',
    ]) {
      writeFileSync(join(root, file), `${file}:v1\n`);
    }
    const fakeRunner = join(root, 'runner.mjs');
    writeFileSync(fakeRunner, 'export {};\n');
    const initial = executionBundleDigest(root, fakeRunner);
    writeFileSync(
      join(root, 'node_modules/.prisma/client/query_engine-test.node'),
      'tampered-native-engine\n',
    );
    const changed = executionBundleDigest(root, fakeRunner);
    assert.match(initial, /^[a-f0-9]{64}$/);
    assert.notEqual(changed, initial);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parent Prisma digest changes with exact migration bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'crud-evidence-prisma-'));
  try {
    mkdirSync(join(root, 'migrations/001_initial'), { recursive: true });
    writeFileSync(join(root, 'schema.prisma'), 'datasource db { provider = "postgresql" }\n');
    const migration = join(root, 'migrations/001_initial/migration.sql');
    writeFileSync(migration, 'CREATE TABLE one (id text);\n');
    const initial = prismaSchemaMigrationDigest(root);
    writeFileSync(migration, 'CREATE TABLE two (id text);\n');
    assert.notEqual(prismaSchemaMigrationDigest(root), initial);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function payload(now, expected) {
  return {
    contract: 'msaidizi-crud-execution-evidence/v2',
    harnessVersion: '2.1.0',
    runId: 'runner_test_1',
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    manifestDigest: 'd'.repeat(64),
    provenance: {
      applicationBuildDigest: expected.applicationBuildDigest,
      prismaSchemaMigrationDigest: expected.prismaSchemaMigrationDigest,
    },
    database: {
      disposable: true,
      isolatedSchemaNameDigest: expected.isolatedSchemaNameDigest,
    },
    cases: [
      {
        fixtureId: 'customer-list-positive',
        fixtureVersion: 1,
        capabilityId: 'CustomersController.findAll',
        capabilityContractDigest: 'e'.repeat(64),
        fixtureContractDigest: 'f'.repeat(64),
        controlKind: 'positive',
        outcome: 'passed',
        httpStatus: 200,
        assertions: [{ name: 'returned exact seeded row', passed: true }],
        finishedAt: new Date(now).toISOString(),
      },
    ],
  };
}
