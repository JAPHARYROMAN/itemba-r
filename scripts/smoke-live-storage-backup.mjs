#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2), process.env);
const envFile = options.envFile ?? '.env.staging';
const envFilePath = resolve(rootDir, envFile);
const env = existsSync(envFilePath) ? { ...loadEnv(envFilePath), ...process.env } : process.env;

const apiUrl = normalizeUrl(
  options.apiUrl ?? env.LIVE_SMOKE_API_URL ?? env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001/api/v1',
);
const composeFile = options.composeFile ?? env.LIVE_SMOKE_COMPOSE_FILE ?? 'docker-compose.staging.yml';
const backendContainer = options.backendContainer ?? env.LIVE_SMOKE_BACKEND_CONTAINER ?? 'itemba_r_backend_staging';
const email = env.AUTH_SMOKE_EMAIL ?? env.SEED_ADMIN_EMAIL;
const password = env.AUTH_SMOKE_PASSWORD ?? env.SEED_ADMIN_PASSWORD;

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  if (!email || !password) {
    throw new Error(
      'Missing live smoke credentials. Set AUTH_SMOKE_EMAIL/AUTH_SMOKE_PASSWORD or SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD.',
    );
  }

  const accessToken = await login();
  const user = await getMe(accessToken);
  requirePermissions(user, [
    'companies.read',
    'documents.view',
    'documents.manage',
    'backup_jobs.manage',
    'backup_runs.view',
    'backup_runs.create',
    'backup_runs.download',
    'restore_tests.view',
    'restore_tests.manage',
  ]);

  await assertDashboardShape(accessToken);
  const company = await getFirstCompany(accessToken);
  const documentId = await smokeFilePersistence(accessToken, company);

  if (options.restartBackend) {
    await recreateBackend();
    await assertDownload(accessToken, documentId, options.expectedPayload, 'after backend recreation');
  }

  await cleanupDocument(accessToken, documentId);
  await smokeBackupRestore(accessToken);

  console.log(`smoke-live-storage-backup: OK ${apiUrl}`);
}

async function login() {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJson(response, 'login');
  const data = unwrap(body);
  if (data.requires2FA) {
    throw new Error('Live smoke login requires 2FA; use a dedicated smoke account without 2FA.');
  }
  if (!data.accessToken) throw new Error('Login did not return an access token');
  console.log('live smoke OK: authenticated API user');
  return data.accessToken;
}

async function getMe(accessToken) {
  const response = await apiFetch('/auth/me', { headers: authHeaders(accessToken) });
  const body = await readJson(response, 'auth/me');
  const data = unwrap(body);
  if (!data?.id) throw new Error('auth/me did not return a user id');
  console.log(`live smoke OK: auth/me returned ${data.email ?? data.id}`);
  return data;
}

function requirePermissions(user, permissions) {
  const available = new Set(user.permissions ?? []);
  const missing = permissions.filter((permission) => !available.has(permission));
  if (missing.length > 0) {
    throw new Error(`Live smoke user is missing required permissions: ${missing.join(', ')}`);
  }
  console.log('live smoke OK: required storage/backup permissions are present');
}

async function assertDashboardShape(accessToken) {
  const response = await apiFetch('/dashboard/executive-summary', {
    headers: authHeaders(accessToken),
  });
  const body = await readJson(response, 'dashboard executive summary');
  const summary = unwrap(body);
  for (const path of [
    ['overview', 'companies'],
    ['overview', 'divisions'],
    ['overview', 'branches'],
    ['groupControl', 'documents', 'total'],
  ]) {
    const value = path.reduce((cursor, key) => cursor?.[key], summary);
    if (typeof value !== 'number' || value < 0) {
      throw new Error(`Dashboard summary has invalid ${path.join('.')}: ${value}`);
    }
  }
  console.log('live smoke OK: dashboard data shape and non-negative counts verified');
}

async function getFirstCompany(accessToken) {
  const response = await apiFetch('/companies?limit=1', { headers: authHeaders(accessToken) });
  const body = await readJson(response, 'companies list');
  const payload = unwrap(body);
  const companies = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const company = companies[0];
  if (!company?.id) throw new Error('No accessible company was found for file persistence smoke');
  console.log(`live smoke OK: selected company ${company.name ?? company.id}`);
  return company;
}

async function smokeFilePersistence(accessToken, company) {
  const payload = Buffer.from(
    [
      'ITEMBA-R live file persistence smoke',
      `company=${company.id}`,
      `timestamp=${new Date().toISOString()}`,
      '',
    ].join('\n'),
    'utf8',
  );
  options.expectedPayload = payload;

  const form = new FormData();
  form.append('file', new Blob([payload], { type: 'text/plain' }), 'live-file-persistence-smoke.txt');
  form.append('title', `Live file persistence smoke ${Date.now()}`);
  form.append('ownerType', 'COMPANY');
  form.append('ownerId', company.id);
  form.append('companyId', company.id);
  form.append('category', 'OTHER');
  form.append('description', 'Created by deployment live smoke and soft-deleted after verification.');

  const upload = await apiFetch('/documents/upload', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: form,
  });
  const body = await readJson(upload, 'document upload');
  const document = unwrap(body);
  if (!document.id) throw new Error('Document upload did not return an id');

  await assertDownload(accessToken, document.id, payload, 'before cleanup');
  console.log('live smoke OK: file upload/download hash verified');
  return document.id;
}

async function assertDownload(accessToken, documentId, expected, label) {
  const response = await apiFetch(`/documents/${documentId}/download`, {
    headers: authHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error(`${label} document download failed with HTTP ${response.status}: ${await response.text()}`);
  }

  const actual = Buffer.from(await response.arrayBuffer());
  const expectedHash = sha256(expected);
  const actualHash = sha256(actual);
  if (actualHash !== expectedHash) {
    throw new Error(`${label} document download hash mismatch: expected ${expectedHash}, received ${actualHash}`);
  }
}

async function cleanupDocument(accessToken, documentId) {
  const response = await apiFetch(`/documents/${documentId}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  });
  if (!response.ok) {
    console.warn(`live smoke warning: could not soft-delete document ${documentId}: HTTP ${response.status}`);
    return;
  }
  console.log('live smoke OK: smoke document soft-deleted');
}

async function smokeBackupRestore(accessToken) {
  const backupJob = await createBackupJob(accessToken);
  const requestedRun = await triggerBackupRun(accessToken, backupJob.id);
  const completedRun = await pollBackupRun(accessToken, requestedRun.id);

  assertCompletedBackupRun(completedRun);
  assertArtifactOnDisk(completedRun, 'before optional restart');

  if (options.restartBackend) {
    await recreateBackend();
    assertArtifactOnDisk(completedRun, 'after backend recreation');
  }

  const restoreTest = await requestRestoreVerification(accessToken, completedRun.id);
  await pollRestoreTest(accessToken, restoreTest.id);
  console.log('live smoke OK: backup artifact and restore checksum verification passed');
}

async function createBackupJob(accessToken) {
  const response = await apiFetch('/backup-jobs', {
    method: 'POST',
    headers: jsonAuthHeaders(accessToken),
    body: JSON.stringify({
      name: `Live storage backup smoke ${Date.now()}`,
      backupType: 'DATABASE',
      schedule: 'MANUAL',
      storageTarget: 'LOCAL',
      retentionDays: 7,
    }),
  });
  const body = await readJson(response, 'backup job create');
  const data = unwrap(body);
  if (!data.id) throw new Error('Backup job create did not return an id');
  console.log('live smoke OK: backup job created');
  return data;
}

async function triggerBackupRun(accessToken, backupJobId) {
  const response = await apiFetch('/backup-runs/trigger', {
    method: 'POST',
    headers: jsonAuthHeaders(accessToken),
    body: JSON.stringify({ backupJobId }),
  });
  const body = await readJson(response, 'backup run trigger');
  const data = unwrap(body);
  if (!data.id) throw new Error('Backup run trigger did not return an id');
  console.log('live smoke OK: backup run requested');
  return data;
}

async function pollBackupRun(accessToken, backupRunId) {
  return waitForState(
    `backup run ${backupRunId}`,
    () => getBackupRun(accessToken, backupRunId),
    300_000,
    (run) => {
      if (run.status === 'FAILED') {
        throw new Error(`Backup run failed: ${run.errorMessage ?? 'no error message'}`);
      }
      return run.status === 'COMPLETED';
    },
  );
}

async function getBackupRun(accessToken, backupRunId) {
  const response = await apiFetch(`/backup-runs/${backupRunId}`, {
    headers: authHeaders(accessToken),
  });
  const body = await readJson(response, 'backup run fetch');
  return unwrap(body);
}

function assertCompletedBackupRun(run) {
  if (!run.checksum || !/^[a-f0-9]{64}$/i.test(run.checksum)) {
    throw new Error(`Completed backup has invalid checksum: ${run.checksum}`);
  }
  if (!run.filePath) {
    throw new Error('Completed backup did not include filePath; backup_runs.download permission is required.');
  }
  if (Number(run.fileSizeBytes ?? 0) <= 0) {
    throw new Error(`Completed backup has invalid fileSizeBytes: ${run.fileSizeBytes}`);
  }
}

function assertArtifactOnDisk(run, label) {
  const script = `
const { createHash } = require('crypto');
const { readFileSync, statSync } = require('fs');
const filePath = ${JSON.stringify(run.filePath)};
const expectedChecksum = ${JSON.stringify(run.checksum)};
const stat = statSync(filePath);
const checksum = createHash('sha256').update(readFileSync(filePath)).digest('hex');
if (checksum !== expectedChecksum) {
  throw new Error('checksum mismatch: expected ' + expectedChecksum + ', got ' + checksum);
}
console.log(JSON.stringify({ filePath, checksum, size: stat.size }));
`;
  const result = runProcess('docker', ['exec', backendContainer, 'node', '-e', script], {
    capture: true,
  });
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error(`${label} artifact check returned no output`);
  const artifact = JSON.parse(output);
  if (artifact.size <= 0) throw new Error(`${label} backup artifact is empty`);
  console.log(`live smoke OK: ${label} backup artifact checksum verified`);
}

async function requestRestoreVerification(accessToken, backupRunId) {
  const response = await apiFetch(`/restore-tests/verify/${backupRunId}`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  const body = await readJson(response, 'restore verification request');
  const data = unwrap(body);
  if (!data.id) throw new Error('Restore verification request did not return an id');
  console.log('live smoke OK: restore checksum verification requested');
  return data;
}

async function pollRestoreTest(accessToken, restoreTestId) {
  return waitForState(
    `restore test ${restoreTestId}`,
    () => getRestoreTest(accessToken, restoreTestId),
    240_000,
    (test) => {
      if (test.status === 'FAILED') {
        throw new Error(`Restore test failed: ${test.issuesFound ?? test.resultSummary ?? 'no error message'}`);
      }
      return test.status === 'PASSED';
    },
  );
}

async function getRestoreTest(accessToken, restoreTestId) {
  const response = await apiFetch(`/restore-tests/${restoreTestId}`, {
    headers: authHeaders(accessToken),
  });
  const body = await readJson(response, 'restore test fetch');
  return unwrap(body);
}

async function recreateBackend() {
  console.log('live smoke: recreating backend container for persistence verification');
  runProcess('docker', [
    'compose',
    '--env-file',
    envFilePath,
    '-f',
    resolve(rootDir, composeFile),
    'up',
    '-d',
    '--force-recreate',
    '--no-deps',
    'backend',
  ]);
  await waitForHttp(
    'backend readiness after recreation',
    `${apiUrl}/health/ready`,
    240_000,
    async (response) => {
      if (!response.ok) return false;
      const body = await response.json().catch(() => null);
      const health = unwrap(body);
      return health?.database === 'up' && health?.status !== 'critical';
    },
  );
}

async function apiFetch(path, options = {}, timeoutMs = 30_000) {
  return fetchWithTimeout(resolvePath(apiUrl, path), options, timeoutMs);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

async function waitForState(label, fetchState, timeoutMs, predicate) {
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
      console.log(`live smoke OK: ${label} reached ${state.status}`);
      return state;
    }
    await sleep(3_000);
  }

  throw new Error(`${label} did not finish within ${timeoutMs / 1000}s; last state: ${lastState}`);
}

async function waitForHttp(label, url, timeoutMs, predicate) {
  const startedAt = Date.now();
  let lastError = 'not attempted';

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url);
      if (await predicate(response)) {
        console.log(`live smoke OK: ${label} is ready`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }

    await sleep(3_000);
  }

  throw new Error(`${label} did not become ready within ${timeoutMs / 1000}s; last result: ${lastError}`);
}

function runProcess(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`Unable to run ${command} ${args.join(' ')}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (capture) {
      console.error(result.stdout);
      console.error(result.stderr);
    }
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result;
}

function authHeaders(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

function jsonAuthHeaders(accessToken) {
  return { ...authHeaders(accessToken), 'Content-Type': 'application/json' };
}

function unwrap(body) {
  return body && body.success === true && Object.prototype.hasOwnProperty.call(body, 'data')
    ? body.data
    : body;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeUrl(value) {
  return String(value).replace(/\/+$/, '');
}

function resolvePath(baseUrl, path) {
  return path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function loadEnv(file) {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    values[key] = value;
  }
  return values;
}

function parseArgs(argv, envValues) {
  const parsed = {
    envFile: configValue(envValues.npm_config_env_file),
    apiUrl: configValue(envValues.npm_config_api_url),
    composeFile: configValue(envValues.npm_config_compose_file),
    backendContainer: configValue(envValues.npm_config_backend_container),
    restartBackend: bool(envValues.npm_config_restart_backend),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env-file') {
      parsed.envFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      parsed.envFile = arg.slice('--env-file='.length);
      continue;
    }
    if (arg === '--api-url') {
      parsed.apiUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--api-url=')) {
      parsed.apiUrl = arg.slice('--api-url='.length);
      continue;
    }
    if (arg === '--compose-file') {
      parsed.composeFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--compose-file=')) {
      parsed.composeFile = arg.slice('--compose-file='.length);
      continue;
    }
    if (arg === '--backend-container') {
      parsed.backendContainer = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--backend-container=')) {
      parsed.backendContainer = arg.slice('--backend-container='.length);
      continue;
    }
    if (arg === '--restart-backend') {
      parsed.restartBackend = true;
      continue;
    }
    if (!arg.startsWith('--') && !parsed.envFile) {
      parsed.envFile = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function configValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || ['true', 'false'].includes(normalized.toLowerCase())) return null;
  return normalized;
}

function bool(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
