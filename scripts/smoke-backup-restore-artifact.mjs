#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const allowLocal = args.has('--allow-local');
const useStaging = args.has('--staging');
const useProduction = args.has('--production');

if (useStaging && useProduction) {
  fail('Use either --staging or --production, not both.');
}

if (!process.env.CI && !allowLocal) {
  fail(
    'Refusing to run backup/restore artifact smoke outside CI without --allow-local because deployment compose files use fixed container names and host ports.',
  );
}

const target = useStaging
  ? {
      name: 'staging',
      composeFile: 'docker-compose.staging.yml',
      postgresDb: 'itemba_r_staging_backup_smoke',
      postgresUser: 'itemba_staging_backup_smoke',
    }
  : {
      name: 'production',
      composeFile: 'docker-compose.production.yml',
      postgresDb: 'itemba_r_backup_smoke',
      postgresUser: 'itemba_backup_smoke',
    };

const sampleEnv = {
  POSTGRES_DB: target.postgresDb,
  POSTGRES_USER: target.postgresUser,
  POSTGRES_PASSWORD: 'postgres-backup-smoke-validation-secret-40',
  REDIS_PASSWORD: 'redis-backup-smoke-validation-secret-40',
  JWT_ACCESS_SECRET: 'jwt-access-backup-smoke-validation-secret-40',
  JWT_REFRESH_SECRET: 'jwt-refresh-backup-smoke-validation-secret-40',
  TWO_FACTOR_ENCRYPTION_KEY: 'two-factor-backup-smoke-validation-secret-40',
  REFRESH_TOKEN_PEPPER: 'refresh-pepper-backup-smoke-validation-secret-40',
  APP_ENCRYPTION_KEY: 'app-encryption-backup-smoke-validation-secret-40',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  JOB_WORKER_ENABLED: 'true',
  FRONTEND_URL: 'http://127.0.0.1:3000',
  CORS_ORIGIN: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/api/v1',
  BACKEND_INTERNAL_URL: 'http://backend:3001/api/v1',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_PATH: '/app/storage',
  BACKUP_STORAGE_PATH: '/app/backups',
  BACKUPS_DIR: '/app/backups',
};

const tempDir = mkdtempSync(join(tmpdir(), 'itemba-backup-smoke-'));
const envFile = join(tempDir, `${target.name}.env`);
writeFileSync(
  envFile,
  `${Object.entries(sampleEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`,
  'utf8',
);

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  let shouldPrintDiagnostics = true;
  let exitCode = 0;

  try {
    await runSmoke();
    shouldPrintDiagnostics = false;
    console.log(`smoke-backup-restore-artifact: OK ${target.name}`);
  } catch (error) {
    if (shouldPrintDiagnostics) {
      printDiagnostics();
    }
    console.error(error.message);
    exitCode = 1;
  } finally {
    compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function runSmoke() {
  console.log(`Starting ${target.name} backup/restore artifact smoke...`);
  compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
  compose(['up', '--build', '-d', 'backend']);

  await waitForBackendReady();

  const fixture = createFixture();
  const accessToken = await login(fixture.email, fixture.password);
  const backupJob = await createBackupJob(accessToken);
  const requestedRun = await triggerBackupRun(accessToken, backupJob.id);
  const completedRun = await pollBackupRun(accessToken, requestedRun.id);

  assertCompletedBackupPayload(completedRun);
  assertArtifactOnDisk(completedRun, 'before backend recreation');

  compose(['up', '-d', '--force-recreate', '--no-deps', 'backend']);
  await waitForBackendReady();

  assertArtifactOnDisk(completedRun, 'after backend recreation');
  const restoreTest = await requestRestoreVerification(accessToken, completedRun.id);
  await pollRestoreTest(accessToken, restoreTest.id);
}

function createFixture() {
  const suffix = Date.now().toString();
  const script = `
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const prisma = new PrismaClient();
const suffix = ${JSON.stringify(suffix)};
const password = 'BackupSmoke123!';
(async () => {
  const permissionCodes = [
    'backup_jobs.view',
    'backup_jobs.manage',
    'backup_runs.view',
    'backup_runs.create',
    'backup_runs.download',
    'restore_tests.view',
    'restore_tests.manage',
  ];
  const permissions = await Promise.all(
    permissionCodes.map((code) =>
      prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          description: 'Backup artifact smoke permission ' + code,
          module: code.split('.')[0],
          action: code.split('.')[1],
        },
      }),
    ),
  );
  const group = await prisma.group.create({
    data: { code: 'BASG' + suffix.slice(-8), name: 'Backup Artifact Smoke Group ' + suffix },
  });
  const company = await prisma.company.create({
    data: {
      groupId: group.id,
      code: 'BASC' + suffix.slice(-8),
      name: 'Backup Artifact Smoke Company ' + suffix,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: 'backup_artifact_smoke_' + suffix,
      displayName: 'Backup Artifact Smoke',
      scope: 'COMPANY',
      rolePermissions: {
        create: permissions.map((permission) => ({ permissionId: permission.id })),
      },
    },
  });
  const email = 'backup-artifact-smoke-' + suffix + '@itemba.local';
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: 'Backup Artifact Smoke User',
      status: 'ACTIVE',
      companyId: company.id,
      userRoles: { create: { roleId: role.id } },
      companyAccess: { create: { companyId: company.id, accessLevel: 'MANAGE' } },
    },
  });
  console.log(JSON.stringify({ email, password, companyId: company.id, userId: user.id }));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
`;
  const result = compose(['exec', '-T', 'backend', 'node', '-e', script], { capture: true });
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error('Fixture creation returned no output');
  return JSON.parse(output);
}

async function login(email, password) {
  const response = await fetchWithTimeout(
    'http://127.0.0.1:3001/api/v1/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    30_000,
  );
  const body = await readJson(response, 'login');
  const data = body.data ?? body;
  if (!data.accessToken) throw new Error('Login did not return an access token');
  return data.accessToken;
}

async function createBackupJob(accessToken) {
  const response = await fetchWithTimeout(
    'http://127.0.0.1:3001/api/v1/backup-jobs',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Backup artifact smoke ${target.name} ${Date.now()}`,
        backupType: 'DATABASE',
        schedule: 'MANUAL',
        storageTarget: 'LOCAL',
        retentionDays: 7,
      }),
    },
    30_000,
  );
  const body = await readJson(response, 'backup job create');
  const data = body.data ?? body;
  if (!data.id) throw new Error('Backup job create did not return an id');
  return data;
}

async function triggerBackupRun(accessToken, backupJobId) {
  const response = await fetchWithTimeout(
    'http://127.0.0.1:3001/api/v1/backup-runs/trigger',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ backupJobId }),
    },
    30_000,
  );
  const body = await readJson(response, 'backup run trigger');
  const data = body.data ?? body;
  if (!data.id) throw new Error('Backup run trigger did not return an id');
  return data;
}

async function pollBackupRun(accessToken, backupRunId) {
  return waitForApiState(
    `backup run ${backupRunId}`,
    () => getBackupRun(accessToken, backupRunId),
    240_000,
    (run) => {
      if (run.status === 'FAILED') {
        throw new Error(`Backup run failed: ${run.errorMessage ?? 'no error message'}`);
      }
      return run.status === 'COMPLETED';
    },
  );
}

async function getBackupRun(accessToken, backupRunId) {
  const response = await fetchWithTimeout(
    `http://127.0.0.1:3001/api/v1/backup-runs/${backupRunId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    30_000,
  );
  const body = await readJson(response, 'backup run fetch');
  return body.data ?? body;
}

function assertCompletedBackupPayload(backupRun) {
  if (!backupRun.checksum || !/^[a-f0-9]{64}$/i.test(backupRun.checksum)) {
    throw new Error(`Completed backup has invalid checksum: ${backupRun.checksum}`);
  }
  if (!backupRun.filePath || !backupRun.filePath.startsWith('/app/backups/')) {
    throw new Error(`Completed backup filePath is not under /app/backups: ${backupRun.filePath}`);
  }
  if (!backupRun.fileSizeBytes || Number(backupRun.fileSizeBytes) <= 0) {
    throw new Error(`Completed backup has invalid fileSizeBytes: ${backupRun.fileSizeBytes}`);
  }
}

function assertArtifactOnDisk(backupRun, label) {
  const script = `
const { createHash } = require('crypto');
const { readFileSync, statSync } = require('fs');
const filePath = ${JSON.stringify(backupRun.filePath)};
const expectedChecksum = ${JSON.stringify(backupRun.checksum)};
const stat = statSync(filePath);
const checksum = createHash('sha256').update(readFileSync(filePath)).digest('hex');
if (checksum !== expectedChecksum) {
  throw new Error('checksum mismatch: expected ' + expectedChecksum + ', got ' + checksum);
}
console.log(JSON.stringify({ filePath, checksum, size: stat.size }));
`;
  const result = compose(['exec', '-T', 'backend', 'node', '-e', script], { capture: true });
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error(`${label} artifact check returned no output`);
  const artifact = JSON.parse(output);
  if (artifact.size <= 0) throw new Error(`${label} artifact is empty`);
  console.log(`${label} artifact checksum verified: ${artifact.checksum}`);
}

async function requestRestoreVerification(accessToken, backupRunId) {
  const response = await fetchWithTimeout(
    `http://127.0.0.1:3001/api/v1/restore-tests/verify/${backupRunId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    30_000,
  );
  const body = await readJson(response, 'restore verification request');
  const data = body.data ?? body;
  if (!data.id) throw new Error('Restore verification request did not return a restore test id');
  return data;
}

async function pollRestoreTest(accessToken, restoreTestId) {
  const restoreTest = await waitForApiState(
    `restore test ${restoreTestId}`,
    () => getRestoreTest(accessToken, restoreTestId),
    180_000,
    (test) => {
      if (test.status === 'FAILED') {
        throw new Error(
          `Restore test failed: ${test.issuesFound ?? test.resultSummary ?? 'no error message'}`,
        );
      }
      return test.status === 'PASSED';
    },
  );
  console.log(`restore test passed: ${restoreTest.resultSummary ?? restoreTest.id}`);
  return restoreTest;
}

async function getRestoreTest(accessToken, restoreTestId) {
  const response = await fetchWithTimeout(
    `http://127.0.0.1:3001/api/v1/restore-tests/${restoreTestId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    30_000,
  );
  const body = await readJson(response, 'restore test fetch');
  return body.data ?? body;
}

async function readJson(response, label) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text.slice(0, 200)}`);
  }
}

async function waitForBackendReady() {
  await waitForHttp(
    'backend readiness',
    'http://127.0.0.1:3001/api/v1/health/ready',
    240_000,
    async (response) => {
      if (!response.ok) return false;
      const body = await response.json().catch(() => null);
      const health = body?.data ?? body;
      return health?.database === 'up' && health?.status !== 'critical';
    },
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function compose(composeArgs, options = {}) {
  return runDocker(
    ['compose', '--env-file', envFile, '-f', resolve(rootDir, target.composeFile), ...composeArgs],
    options,
  );
}

function runDocker(dockerArgs, { allowFailure = false, capture = false } = {}) {
  const result = spawnSync('docker', dockerArgs, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    if (allowFailure) {
      console.error(`Unable to run docker ${dockerArgs.join(' ')}: ${result.error.message}`);
      return result;
    }
    throw new Error(`Unable to run docker ${dockerArgs.join(' ')}: ${result.error.message}`);
  }

  if (result.status !== 0 && !allowFailure) {
    if (capture) {
      console.error(result.stdout);
      console.error(result.stderr);
    }
    throw new Error(`docker ${dockerArgs.join(' ')} failed with exit code ${result.status}`);
  }

  return result;
}

async function waitForHttp(label, url, timeoutMs, predicate) {
  const startedAt = Date.now();
  let lastError = 'not attempted';

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url);
      if (await predicate(response)) {
        console.log(`${label} is ready`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }

    await sleep(3_000);
  }

  throw new Error(
    `${label} did not become ready within ${timeoutMs / 1000}s; last result: ${lastError}`,
  );
}

async function waitForApiState(label, fetchState, timeoutMs, predicate) {
  const startedAt = Date.now();
  let lastState = 'not attempted';

  while (Date.now() - startedAt < timeoutMs) {
    const state = await fetchState();
    lastState = JSON.stringify({
      id: state.id,
      status: state.status,
      errorMessage: state.errorMessage,
      issuesFound: state.issuesFound,
    });
    if (predicate(state)) {
      console.log(`${label} reached ${state.status}`);
      return state;
    }
    await sleep(3_000);
  }

  throw new Error(`${label} did not finish within ${timeoutMs / 1000}s; last state: ${lastState}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function printDiagnostics() {
  console.error(`\n${target.name} backup/restore artifact diagnostics:`);
  compose(['ps'], { allowFailure: true });
  compose(
    ['logs', '--no-color', '--tail', '220', 'backend-migrate', 'backend', 'postgres', 'redis'],
    {
      allowFailure: true,
    },
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
