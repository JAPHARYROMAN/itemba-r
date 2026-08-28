#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, randomUUID, sign as cryptoSign } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  canonicalJson,
  executionBundleDigest,
  prismaSchemaMigrationDigest,
  sanitizedEvidenceChildEnvironment,
  validateUnsignedCrudPayload,
} from './crud-evidence-runner-lib.mjs';

const backendDir = resolve(import.meta.dirname, '..');
const schemaPath = '../database/prisma/schema.prisma';
const prismaCliPath = resolve(backendDir, 'node_modules/prisma/build/index.js');
const databaseUrl = process.env.DATABASE_URL || readEnvFileValue('DATABASE_URL');
const privateKeyPath = requiredAbsolute('MSAIDIZI_CRUD_EVIDENCE_PRIVATE_KEY_PATH');
const outputPath = requiredAbsolute('MSAIDIZI_CRUD_EVIDENCE_OUTPUT_PATH');
const keyId = required('MSAIDIZI_CRUD_EVIDENCE_SIGNING_KEY_ID');

if (!existsSync(privateKeyPath)) fail(`Evidence signing key does not exist: ${privateKeyPath}`);
const privateKeyStat = lstatSync(privateKeyPath);
if (privateKeyStat.isSymbolicLink() || !privateKeyStat.isFile()) {
  fail('Evidence signing key path must identify a real file, not a symlink.');
}
if (!existsSync(dirname(outputPath))) {
  fail(`Evidence output directory does not exist: ${dirname(outputPath)}`);
}
const outputDirectoryStat = lstatSync(dirname(outputPath));
if (outputDirectoryStat.isSymbolicLink() || !outputDirectoryStat.isDirectory()) {
  fail('Evidence output directory must be a real directory, not a symlink.');
}
if (existsSync(outputPath)) {
  fail(`Evidence output path already exists and will not be overwritten: ${outputPath}`);
}
if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)) {
  fail('MSAIDIZI_CRUD_EVIDENCE_SIGNING_KEY_ID contains unsupported characters or is too long.');
}
if (!databaseUrl) fail('DATABASE_URL is required to create an isolated CRUD evidence schema.');

let baseUrl;
try {
  baseUrl = new URL(databaseUrl);
} catch {
  fail('DATABASE_URL must be a valid PostgreSQL URL.');
}
if (!['postgres:', 'postgresql:'].includes(baseUrl.protocol)) {
  fail('DATABASE_URL must use the PostgreSQL connector.');
}

const databaseName = decodeURIComponent(baseUrl.pathname.replace(/^\//, ''));
if (!databaseName) fail('DATABASE_URL must name an exact PostgreSQL database.');
const databaseTarget = `${baseUrl.host.toLowerCase()}/${databaseName}`;
const acknowledgement = required('CRUD_COVERAGE_DISPOSABLE_DATABASE_ACK');
if (acknowledgement !== databaseTarget) {
  fail(
    `CRUD_COVERAGE_DISPOSABLE_DATABASE_ACK must exactly equal ${databaseTarget}; ` +
      'the evidence runner never infers destructive database authority.',
  );
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const normalizedHostname = baseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
const exactAllowlist = new Set(
  (process.env.CRUD_COVERAGE_DATABASE_ALLOWLIST ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const obviousSharedEnvironment = /(^|[-_.])(prod(uction)?|stag(e|ing)?)([-_.]|$)/i.test(
  databaseTarget,
);
if (
  (!loopbackHosts.has(normalizedHostname) || obviousSharedEnvironment) &&
  !exactAllowlist.has(databaseTarget.toLowerCase())
) {
  fail(
    `Refusing CRUD evidence against ${databaseTarget}. ` +
      'Non-loopback and production/staging-like targets require an exact host/database entry in ' +
      'CRUD_COVERAGE_DATABASE_ALLOWLIST.',
  );
}

const random = randomUUID().replaceAll('-', '').slice(0, 20);
const pendingOutputPath = `${outputPath}.${random}.pending`;
const unsignedOutputPath = `${outputPath}.${random}.unsigned`;
for (const candidate of [pendingOutputPath, unsignedOutputPath]) {
  if (existsSync(candidate)) fail(`Pending evidence path already exists: ${candidate}`);
}
const isolatedSchema = `msaidizi_crud_evidence_${Date.now()}_${random}`;
if (!/^msaidizi_crud_evidence_[a-z0-9_]{8,80}$/.test(isolatedSchema)) {
  fail('Generated evidence schema did not pass the destructive-operation allowlist.');
}

const isolatedUrl = new URL(baseUrl);
isolatedUrl.searchParams.set('schema', isolatedSchema);
const maintenanceUrl = new URL(baseUrl);
maintenanceUrl.searchParams.set('schema', 'public');
const runStartedAtMs = Date.now();
const applicationBuildDigest = executionBundleDigest(
  backendDir,
  resolve(import.meta.dirname, 'run-crud-evidence.mjs'),
);
const prismaRoot = resolve(backendDir, '../database/prisma');
const prismaBuildDigest = prismaSchemaMigrationDigest(prismaRoot);

let testStatus = 1;
let cleanupStatus = 1;
try {
  sql(maintenanceUrl.toString(), `CREATE SCHEMA "${isolatedSchema}";`);
  run(process.execPath, [prismaCliPath, 'migrate', 'deploy', `--schema=${schemaPath}`], {
    DATABASE_URL: isolatedUrl.toString(),
  });

  const result = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=8192',
      './node_modules/jest/bin/jest.js',
      '--config',
      './test/jest-e2e.json',
      '--no-cache',
      '--runInBand',
      '--ci',
      '--runTestsByPath',
      './test/crud-coverage-loopback.e2e-spec.ts',
    ],
    {
      cwd: backendDir,
      env: evidenceChildEnvironment(isolatedUrl.toString()),
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  testStatus = result.status ?? 1;
  if (result.error) console.error(`Evidence Jest process failed: ${result.error.message}`);
} finally {
  try {
    sql(maintenanceUrl.toString(), `DROP SCHEMA "${isolatedSchema}" CASCADE;`);
    cleanupStatus = 0;
  } catch (error) {
    console.error(`Failed to drop isolated evidence schema ${isolatedSchema}: ${error.message}`);
  }
}

if (testStatus !== 0 || cleanupStatus !== 0) {
  // The harness deliberately writes failure evidence for diagnostics. Never
  // promote or summarize that payload as the requested release artifact.
  rmSync(unsignedOutputPath, { force: true });
  rmSync(pendingOutputPath, { force: true });
  process.exit(testStatus !== 0 ? testStatus : cleanupStatus);
}
if (!existsSync(unsignedOutputPath)) {
  fail('CRUD evidence Jest passed without producing its run-unique unsigned payload.');
}
const runFinishedAtMs = Date.now();
const finalApplicationBuildDigest = executionBundleDigest(
  backendDir,
  resolve(import.meta.dirname, 'run-crud-evidence.mjs'),
);
if (finalApplicationBuildDigest !== applicationBuildDigest) {
  rmSync(unsignedOutputPath, { force: true });
  rmSync(pendingOutputPath, { force: true });
  fail('Evidence execution bundle changed while CRUD evidence was executing.');
}
const finalPrismaBuildDigest = prismaSchemaMigrationDigest(prismaRoot);
if (finalPrismaBuildDigest !== prismaBuildDigest) {
  rmSync(unsignedOutputPath, { force: true });
  rmSync(pendingOutputPath, { force: true });
  fail('Prisma schema or migrations changed while CRUD evidence was executing.');
}
const payload = readAndValidateUnsignedPayload(unsignedOutputPath, {
  applicationBuildDigest,
  prismaSchemaMigrationDigest: prismaBuildDigest,
  isolatedSchemaNameDigest: createHash('sha256').update(isolatedSchema).digest('hex'),
  runStartedAtMs,
  runFinishedAtMs,
});
writeSignedArtifact(payload, pendingOutputPath);
rmSync(unsignedOutputPath, { force: true });
try {
  // A hard-link publish is atomic and fails if a competing process created the
  // release path after preflight. rename() would overwrite on POSIX.
  linkSync(pendingOutputPath, outputPath);
  unlinkSync(pendingOutputPath);
} catch (error) {
  rmSync(pendingOutputPath, { force: true });
  fail(`Could not atomically publish CRUD evidence without overwrite: ${error.message}`);
}
printArtifactSummary(outputPath);

function evidenceChildEnvironment(isolatedDatabaseUrl) {
  return sanitizedEvidenceChildEnvironment(process.env, {
    DATABASE_URL: isolatedDatabaseUrl,
    CRUD_COVERAGE_DISPOSABLE_DB: '1',
    CRUD_COVERAGE_SCHEMA: isolatedSchema,
    CRUD_COVERAGE_UNSIGNED_OUTPUT_PATH: unsignedOutputPath,
    CRUD_COVERAGE_APPLICATION_BUILD_DIGEST: applicationBuildDigest,
  });
}

function readAndValidateUnsignedPayload(path, expected) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    rmSync(path, { force: true });
    fail(`CRUD evidence payload is not valid JSON: ${error.message}`);
  }
  try {
    return validateUnsignedCrudPayload(payload, expected);
  } catch (error) {
    rmSync(path, { force: true });
    fail(error instanceof Error ? error.message : 'CRUD evidence child produced invalid output.');
  }
}

function writeSignedArtifact(payload, path) {
  const privateKey = createPrivateKey(readFileSync(privateKeyPath));
  const curve = privateKey.asymmetricKeyDetails?.namedCurve;
  if (privateKey.asymmetricKeyType !== 'ec' || !['prime256v1', 'P-256'].includes(curve)) {
    fail('CRUD evidence signing key must be an EC P-256 key.');
  }
  const canonicalPayload = canonicalJson(payload);
  const signature = cryptoSign('sha256', Buffer.from(canonicalPayload, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  if (signature.length !== 64) fail('CRUD evidence signer produced a non-P1363 signature.');
  const artifact = {
    ...payload,
    payloadDigest: createHash('sha256').update(canonicalPayload).digest('hex'),
    signature: {
      algorithm: 'ES256',
      keyId,
      value: signature.toString('base64'),
    },
  };
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

function sql(url, statement) {
  const result = spawnSync(
    process.execPath,
    [prismaCliPath, 'db', 'execute', `--url=${url}`, '--stdin'],
    {
      cwd: backendDir,
      env: process.env,
      input: statement,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (result.status !== 0 || result.error) {
    throw new Error(
      result.stderr || result.stdout || result.error?.message || 'prisma db execute failed',
    );
  }
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: backendDir,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(
      result.error?.message || `${command} ${args.join(' ')} failed with ${result.status}.`,
    );
  }
}

function printArtifactSummary(path) {
  try {
    const artifact = JSON.parse(readFileSync(path, 'utf8'));
    const cases = Array.isArray(artifact.cases) ? artifact.cases : [];
    const positives = cases.filter((item) => item.controlKind === 'positive');
    const security = cases.filter((item) => item.controlKind !== 'positive');
    console.log(
      [
        `CRUD evidence artifact: ${path}`,
        `Evidence contract: ${artifact.contract || 'missing'}`,
        `Harness version: ${artifact.harnessVersion || 'missing'}`,
        `Manifest digest: ${artifact.manifestDigest || 'missing'}`,
        `Payload digest: ${artifact.payloadDigest || 'missing'}`,
        `Application build digest: ${artifact.provenance?.applicationBuildDigest || 'missing'}`,
        `Prisma schema/migration digest: ${
          artifact.provenance?.prismaSchemaMigrationDigest || 'missing'
        }`,
        `Disposable schema-name digest: ${
          artifact.database?.isolatedSchemaNameDigest || 'missing'
        }`,
        `Positive fixtures: ${positives.filter(passed).length}/${positives.length} passed`,
        `Security controls: ${security.filter(passed).length}/${security.length} passed`,
        `Failed/skipped: ${
          cases
            .filter((item) => !passed(item))
            .map((item) => item.fixtureId)
            .join(', ') || 'none'
        }`,
      ].join('\n'),
    );
  } catch (error) {
    console.error(`Could not summarize evidence artifact: ${error.message}`);
  }
}

function passed(item) {
  return item?.outcome === 'passed';
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function requiredAbsolute(name) {
  const value = required(name);
  if (!isAbsolute(value)) fail(`${name} must be an absolute external path.`);
  return value;
}

function readEnvFileValue(key) {
  const file = resolve(backendDir, '.env');
  if (!existsSync(file)) return undefined;
  const match = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && line.startsWith(`${key}=`));
  return match?.slice(key.length + 1).replace(/^["']|["']$/g, '');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
