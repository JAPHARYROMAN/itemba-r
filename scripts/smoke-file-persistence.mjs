#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
    'Refusing to run file persistence smoke outside CI without --allow-local because deployment compose files use fixed container names and host ports.',
  );
}

const target = useStaging
  ? {
      name: 'staging',
      composeFile: 'docker-compose.staging.yml',
      postgresDb: 'itemba_r_staging_file_smoke',
      postgresUser: 'itemba_staging_file_smoke',
    }
  : {
      name: 'production',
      composeFile: 'docker-compose.production.yml',
      postgresDb: 'itemba_r_file_smoke',
      postgresUser: 'itemba_file_smoke',
    };

const sampleEnv = {
  POSTGRES_DB: target.postgresDb,
  POSTGRES_USER: target.postgresUser,
  POSTGRES_PASSWORD: 'postgres-file-smoke-validation-secret-40',
  REDIS_PASSWORD: 'redis-file-smoke-validation-secret-40',
  JWT_ACCESS_SECRET: 'jwt-access-file-smoke-validation-secret-40',
  JWT_REFRESH_SECRET: 'jwt-refresh-file-smoke-validation-secret-40',
  TWO_FACTOR_ENCRYPTION_KEY: 'two-factor-file-smoke-validation-secret-40',
  REFRESH_TOKEN_PEPPER: 'refresh-pepper-file-smoke-validation-secret-40',
  APP_ENCRYPTION_KEY: 'app-encryption-file-smoke-validation-secret-40',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  JOB_WORKER_ENABLED: 'true',
  FRONTEND_URL: 'http://127.0.0.1:3000',
  CORS_ORIGIN: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/api/v1',
  BACKEND_INTERNAL_URL: 'http://backend:3001/api/v1',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_PATH: '/app/storage',
};

const tempDir = mkdtempSync(join(tmpdir(), 'itemba-file-smoke-'));
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
    console.log(`smoke-file-persistence: OK ${target.name}`);
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
  console.log(`Starting ${target.name} file persistence smoke...`);
  compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
  compose(['up', '--build', '-d', 'backend']);

  await waitForBackendReady();

  const fixture = createFixture();
  const accessToken = await login(fixture.email, fixture.password);
  const payload = Buffer.from(
    [
      'ITEMBA-R file persistence smoke',
      `target=${target.name}`,
      `fixture=${fixture.companyId}`,
      `timestamp=${new Date().toISOString()}`,
      '',
    ].join('\n'),
    'utf8',
  );

  const document = await uploadDocument(accessToken, fixture.companyId, payload);
  await assertDownload(accessToken, document.id, payload, 'before backend recreation');

  compose(['up', '-d', '--force-recreate', '--no-deps', 'backend']);
  await waitForBackendReady();

  await assertDownload(accessToken, document.id, payload, 'after backend recreation');
}

function createFixture() {
  const suffix = Date.now().toString();
  const script = `
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const prisma = new PrismaClient();
const suffix = ${JSON.stringify(suffix)};
const password = 'FileSmoke123!';
(async () => {
  const permissions = await Promise.all(
    ['documents.view', 'documents.manage'].map((code) =>
      prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          description: 'File persistence smoke permission ' + code,
          module: 'documents',
          action: code.split('.')[1],
        },
      }),
    ),
  );
  const group = await prisma.group.create({
    data: { code: 'FPSG' + suffix.slice(-8), name: 'File Persistence Smoke Group ' + suffix },
  });
  const company = await prisma.company.create({
    data: {
      groupId: group.id,
      code: 'FPSC' + suffix.slice(-8),
      name: 'File Persistence Smoke Company ' + suffix,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: 'file_persistence_smoke_' + suffix,
      displayName: 'File Persistence Smoke',
      scope: 'COMPANY',
      rolePermissions: {
        create: permissions.map((permission) => ({ permissionId: permission.id })),
      },
    },
  });
  const email = 'file-persistence-smoke-' + suffix + '@itemba.local';
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: 'File Persistence Smoke User',
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

async function uploadDocument(accessToken, companyId, payload) {
  const form = new FormData();
  form.append('file', new Blob([payload], { type: 'text/plain' }), 'file-persistence-smoke.txt');
  form.append('title', 'File persistence smoke');
  form.append('ownerType', 'COMPANY');
  form.append('ownerId', companyId);
  form.append('companyId', companyId);
  form.append('category', 'OTHER');

  const response = await fetchWithTimeout(
    'http://127.0.0.1:3001/api/v1/documents/upload',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    },
    30_000,
  );
  const body = await readJson(response, 'document upload');
  const data = body.data ?? body;
  if (!data.id) throw new Error('Document upload did not return a document id');
  return data;
}

async function assertDownload(accessToken, documentId, expected, label) {
  const response = await fetchWithTimeout(
    `http://127.0.0.1:3001/api/v1/documents/${documentId}/download`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    30_000,
  );

  if (!response.ok) {
    throw new Error(
      `${label} download failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }

  const actual = Buffer.from(await response.arrayBuffer());
  const expectedHash = sha256(expected);
  const actualHash = sha256(actual);
  if (actualHash !== expectedHash) {
    throw new Error(
      `${label} download hash mismatch: expected ${expectedHash}, received ${actualHash}`,
    );
  }
  console.log(`${label} download hash verified: ${actualHash}`);
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function printDiagnostics() {
  console.error(`\n${target.name} file persistence diagnostics:`);
  compose(['ps'], { allowFailure: true });
  compose(
    ['logs', '--no-color', '--tail', '180', 'backend-migrate', 'backend', 'postgres', 'redis'],
    {
      allowFailure: true,
    },
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
