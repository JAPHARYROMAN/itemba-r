import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const CRUD_EVIDENCE_CONTRACT = 'msaidizi-crud-execution-evidence/v2';
const CRUD_EVIDENCE_HARNESS_VERSION = '2.1.0';
export const CRUD_EVIDENCE_MAX_CASE_ASSERTIONS = 64;
export const CRUD_EVIDENCE_ACCESS_TOKEN_TTL = '30m';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Hashes the complete executable evidence bundle, including installed JS,
 * generated Prisma code and native engines. A package lock describes intended
 * dependencies; this digest attests the bytes that actually executed.
 */
export function executionBundleDigest(backendDirectory, runnerPath) {
  const backendDir = resolve(backendDirectory);
  const files = [];
  const symlinks = [];
  const roots = [
    { path: join(backendDir, 'src'), allowInternalSymlinks: false },
    { path: join(backendDir, 'test'), allowInternalSymlinks: false },
    { path: join(backendDir, 'node_modules'), allowInternalSymlinks: true },
  ];
  const standaloneFiles = [
    resolve(runnerPath),
    resolve(import.meta.dirname, 'crud-evidence-runner-lib.mjs'),
    join(backendDir, 'package.json'),
    join(backendDir, 'package-lock.json'),
    join(backendDir, 'nest-cli.json'),
    join(backendDir, 'tsconfig.json'),
    join(backendDir, 'tsconfig.build.json'),
  ];

  for (const root of roots) {
    visitExecutionTree(root.path, files, symlinks, root.path, root.allowInternalSymlinks);
  }
  files.push(...standaloneFiles);

  const entries = [
    ...files.map((absolute) => {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`CRUD evidence execution input must be a real file: ${absolute}`);
      }
      const content = readFileSync(absolute);
      return {
        type: 'file',
        path: releasePath(backendDir, absolute),
        bytes: content.length,
        sha256: sha256Hex(content),
      };
    }),
    ...symlinks.map(({ absolute, target }) => ({
      type: 'symlink',
      path: releasePath(backendDir, absolute),
      target: target.replaceAll('\\', '/'),
    })),
  ].sort((left, right) => compareOrdinalUtf8(left.path, right.path));

  const duplicate = entries.find(
    (entry, index) => index > 0 && entries[index - 1].path === entry.path,
  );
  if (duplicate) throw new Error(`Duplicate CRUD evidence execution input: ${duplicate.path}`);
  return sha256Hex(canonicalJson(entries));
}

/** Independently mirrors the production verifier's Prisma-tree attestation. */
export function prismaSchemaMigrationDigest(prismaDirectory) {
  const root = resolve(prismaDirectory);
  const schemaPath = join(root, 'schema.prisma');
  const migrationsPath = join(root, 'migrations');
  const files = [schemaPath];

  requireRealDirectory(root, 'Prisma evidence root');
  requireRealFile(schemaPath, 'Prisma schema.prisma');
  requireRealDirectory(migrationsPath, 'Prisma migrations root');
  visitNoSymlinkTree(migrationsPath, files);

  const entries = files
    .map((absolute) => {
      const content = readFileSync(absolute);
      return {
        path: relative(root, absolute).replaceAll('\\', '/'),
        bytes: content.length,
        sha256: sha256Hex(content),
      };
    })
    .sort((left, right) => compareOrdinalUtf8(left.path, right.path));
  return sha256Hex(canonicalJson(entries));
}

/**
 * Treat the Jest output as untrusted input. Only a closed, successful payload
 * bound to facts independently known by the parent is eligible for signing.
 */
export function validateUnsignedCrudPayload(input, expected) {
  const payload = requireRecord(input, 'CRUD evidence payload');
  requireExactKeys(
    payload,
    [
      'cases',
      'contract',
      'database',
      'expiresAt',
      'generatedAt',
      'harnessVersion',
      'manifestDigest',
      'provenance',
      'runId',
    ],
    'CRUD evidence payload',
  );

  if (
    payload.contract !== CRUD_EVIDENCE_CONTRACT ||
    payload.harnessVersion !== CRUD_EVIDENCE_HARNESS_VERSION ||
    typeof payload.runId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(payload.runId) ||
    !isSha256(payload.manifestDigest)
  ) {
    throw new Error('CRUD evidence child produced a malformed unsigned payload.');
  }

  const provenance = requireRecord(payload.provenance, 'CRUD evidence provenance');
  requireExactKeys(
    provenance,
    ['applicationBuildDigest', 'prismaSchemaMigrationDigest'],
    'CRUD evidence provenance',
  );
  if (provenance.applicationBuildDigest !== expected.applicationBuildDigest) {
    throw new Error('CRUD evidence payload is not bound to the parent-computed execution bundle.');
  }
  if (provenance.prismaSchemaMigrationDigest !== expected.prismaSchemaMigrationDigest) {
    throw new Error('CRUD evidence payload is not bound to the parent-computed Prisma tree.');
  }

  const database = requireRecord(payload.database, 'CRUD evidence database provenance');
  requireExactKeys(
    database,
    ['disposable', 'isolatedSchemaNameDigest'],
    'CRUD evidence database provenance',
  );
  if (
    database.disposable !== true ||
    database.isolatedSchemaNameDigest !== expected.isolatedSchemaNameDigest
  ) {
    throw new Error('CRUD evidence payload is not bound to the runner-created disposable schema.');
  }

  const generatedAt = parseIsoTimestamp(payload.generatedAt, 'generatedAt');
  const expiresAt = parseIsoTimestamp(payload.expiresAt, 'expiresAt');
  if (
    generatedAt < expected.runStartedAtMs - CLOCK_SKEW_MS ||
    generatedAt > expected.runFinishedAtMs + CLOCK_SKEW_MS ||
    expiresAt - generatedAt !== SEVEN_DAYS_MS
  ) {
    throw new Error('CRUD evidence payload timestamps are outside the exact run validity window.');
  }

  if (!Array.isArray(payload.cases) || payload.cases.length === 0) {
    throw new Error('CRUD evidence payload must contain at least one executed case.');
  }
  const fixtureIds = new Set();
  let previousFixtureId = '';
  for (const item of payload.cases) {
    validatePassedCase(item, fixtureIds, previousFixtureId, expected);
    previousFixtureId = item.fixtureId;
  }
  return payload;
}

/** Remove every parent-only evidence signing/output handle before Jest/Nest starts. */
export function sanitizedEvidenceChildEnvironment(parentEnvironment, overlay) {
  const environment = { ...parentEnvironment };
  const exactSecrets = new Set([
    'ANTHROPIC_API_KEY',
    'MSAIDIZI_CRUD_EVIDENCE_PRIVATE_KEY_PATH',
    'MSAIDIZI_CRUD_EVIDENCE_OUTPUT_PATH',
    'MSAIDIZI_CRUD_EVIDENCE_SIGNING_KEY_ID',
    'CRUD_COVERAGE_EVIDENCE_KEY_ID',
  ]);
  for (const name of Object.keys(environment)) {
    const normalized = name.toUpperCase();
    if (
      exactSecrets.has(normalized) ||
      normalized.startsWith('MSAIDIZI_PROVIDER_CONTRACT_') ||
      (/CRUD.*EVIDENCE/.test(normalized) &&
        /(PRIVATE|SIGNING).*KEY|RELEASE.*OUTPUT/.test(normalized))
    ) {
      delete environment[name];
    }
  }
  return {
    ...environment,
    ...overlay,
    // The live matrix has a hard 20-minute Jest ceiling. Keep access tokens
    // finite while ensuring a slow but valid run cannot cross a workstation's
    // shorter production TTL and turn all remaining controls into HTTP 401s.
    JWT_ACCESS_EXPIRES_IN: CRUD_EVIDENCE_ACCESS_TOKEN_TTL,
    // The CRUD harness never invokes a model, starts a task worker, or contacts
    // a device. It boots with every autonomy path disabled; the loopback test
    // may then enable only in-process task-credential validation to exercise
    // isolated, directly seeded service-principal controls. Force the external
    // paths off after the caller overlay so a developer .env cannot turn an
    // evidence run into cloud disclosure or workstation execution.
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
  };
}

function validatePassedCase(input, fixtureIds, previousFixtureId, expected) {
  const item = requireRecord(input, 'CRUD evidence case');
  requireExactKeys(
    item,
    [
      'assertions',
      'capabilityContractDigest',
      'capabilityId',
      'controlKind',
      'finishedAt',
      'fixtureContractDigest',
      'fixtureId',
      'fixtureVersion',
      'httpStatus',
      'outcome',
    ],
    'CRUD evidence case',
  );
  const fixtureId = item.fixtureId;
  const controlKind = item.controlKind;
  const caseLabel =
    typeof fixtureId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(fixtureId)
      ? fixtureId
      : '<malformed-fixture-id>';
  const successfulStatus =
    controlKind === 'permission_denial'
      ? item.httpStatus === 403
      : controlKind === 'company_isolation'
        ? item.httpStatus === 403 || item.httpStatus === 404
        : Number.isInteger(item.httpStatus) && item.httpStatus >= 200 && item.httpStatus < 300;
  if (caseLabel === '<malformed-fixture-id>') {
    throw new Error('CRUD evidence child produced a case with a malformed fixture ID.');
  }
  if (fixtureIds.has(fixtureId)) {
    throw new Error(`CRUD evidence child produced duplicate case ${caseLabel}.`);
  }
  if (compareOrdinalUtf8(fixtureId, previousFixtureId) < 0) {
    throw new Error(`CRUD evidence case ${caseLabel} is not sorted by fixture ID.`);
  }
  if (!Number.isInteger(item.fixtureVersion) || item.fixtureVersion < 1) {
    throw new Error(`CRUD evidence case ${caseLabel} has an invalid fixture version.`);
  }
  if (
    typeof item.capabilityId !== 'string' ||
    item.capabilityId.length < 1 ||
    item.capabilityId.length > 256
  ) {
    throw new Error(`CRUD evidence case ${caseLabel} has an invalid capability ID.`);
  }
  if (!isSha256(item.capabilityContractDigest) || !isSha256(item.fixtureContractDigest)) {
    throw new Error(`CRUD evidence case ${caseLabel} has an invalid contract digest.`);
  }
  if (
    ![
      'positive',
      'permission_denial',
      'company_isolation',
      'audit_attribution',
      'service_principal_task_scope',
    ].includes(controlKind)
  ) {
    throw new Error(`CRUD evidence case ${caseLabel} has an unsupported control kind.`);
  }
  if (item.outcome !== 'passed') {
    throw new Error(`CRUD evidence child produced a failed case ${caseLabel}.`);
  }
  if (!successfulStatus) {
    throw new Error(
      `CRUD evidence case ${caseLabel} has HTTP status ${String(item.httpStatus)} for ${String(controlKind)}.`,
    );
  }
  if (!Array.isArray(item.assertions)) {
    throw new Error(`CRUD evidence case ${caseLabel} has no assertion array.`);
  }
  if (item.assertions.length < 1) {
    throw new Error(`CRUD evidence case ${caseLabel} has no assertions.`);
  }
  if (item.assertions.length > CRUD_EVIDENCE_MAX_CASE_ASSERTIONS) {
    throw new Error(
      `CRUD evidence case ${caseLabel} has ${item.assertions.length} assertions; maximum is ${CRUD_EVIDENCE_MAX_CASE_ASSERTIONS}.`,
    );
  }
  const finishedAt = parseIsoTimestamp(item.finishedAt, `${fixtureId}.finishedAt`);
  if (
    finishedAt < expected.runStartedAtMs - CLOCK_SKEW_MS ||
    finishedAt > expected.runFinishedAtMs + CLOCK_SKEW_MS
  ) {
    throw new Error(`CRUD evidence case ${fixtureId} finished outside the exact run window.`);
  }
  for (const rawAssertion of item.assertions) {
    const assertion = requireRecord(rawAssertion, `${fixtureId} assertion`);
    const allowedKeys =
      assertion.detail === undefined ? ['name', 'passed'] : ['detail', 'name', 'passed'];
    requireExactKeys(assertion, allowedKeys, `${fixtureId} assertion`);
    if (
      typeof assertion.name !== 'string' ||
      assertion.name.length < 1 ||
      assertion.name.length > 256 ||
      assertion.passed !== true ||
      (assertion.detail !== undefined &&
        (typeof assertion.detail !== 'string' || assertion.detail.length > 512))
    ) {
      throw new Error(`CRUD evidence case ${fixtureId} contains a malformed or failed assertion.`);
    }
  }
  fixtureIds.add(fixtureId);
}

function visitExecutionTree(directory, files, symlinks, policyRoot, allowInternalSymlinks) {
  requireRealDirectory(directory, 'CRUD evidence execution root');
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (!allowInternalSymlinks) {
        throw new Error(`CRUD evidence execution tree contains a symlink: ${absolute}`);
      }
      const resolvedTarget = realpathSync(absolute);
      const relativeTarget = relative(policyRoot, resolvedTarget);
      if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
        throw new Error(`CRUD evidence dependency symlink escapes node_modules: ${absolute}`);
      }
      symlinks.push({ absolute, target: readlinkSync(absolute) });
      continue;
    }
    if (entry.isDirectory()) {
      visitExecutionTree(absolute, files, symlinks, policyRoot, allowInternalSymlinks);
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
}

function visitNoSymlinkTree(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Prisma evidence input must not contain symlinks: ${absolute}`);
    }
    if (entry.isDirectory()) visitNoSymlinkTree(absolute, files);
    else if (entry.isFile()) files.push(absolute);
  }
}

function requireRealDirectory(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symlink: ${path}`);
  }
}

function requireRealFile(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a real file, not a symlink: ${path}`);
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} contains missing or unsupported fields.`);
  }
}

function parseIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`CRUD evidence ${label} must be a canonical UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`CRUD evidence ${label} is not a valid canonical timestamp.`);
  }
  return parsed;
}

function releasePath(backendDir, absolute) {
  const result = relative(backendDir, absolute).replaceAll('\\', '/');
  if (result.startsWith('../')) return `workspace/${result}`;
  return result;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Evidence cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((name) => value[name] !== undefined)
      .sort()
      .map((name) => `${JSON.stringify(name)}:${canonicalJson(value[name])}`)
      .join(',')}}`;
  }
  throw new TypeError(`Evidence contains unsupported value type ${typeof value}.`);
}

function compareOrdinalUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
