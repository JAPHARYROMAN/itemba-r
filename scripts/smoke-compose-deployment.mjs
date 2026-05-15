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
    'Refusing to run compose runtime smoke outside CI without --allow-local because deployment compose files use fixed container names and host ports.',
  );
}

const target = useStaging
  ? {
      name: 'staging',
      composeFile: 'docker-compose.staging.yml',
      postgresDb: 'itemba_r_staging_smoke',
      postgresUser: 'itemba_staging_smoke',
    }
  : {
      name: 'production',
      composeFile: 'docker-compose.production.yml',
      postgresDb: 'itemba_r_smoke',
      postgresUser: 'itemba_smoke',
    };

const sampleEnv = {
  POSTGRES_DB: target.postgresDb,
  POSTGRES_USER: target.postgresUser,
  POSTGRES_PASSWORD: 'postgres-smoke-validation-secret-40',
  REDIS_PASSWORD: 'redis-smoke-validation-secret-40',
  JWT_ACCESS_SECRET: 'jwt-access-smoke-validation-secret-40',
  JWT_REFRESH_SECRET: 'jwt-refresh-smoke-validation-secret-40',
  TWO_FACTOR_ENCRYPTION_KEY: 'two-factor-smoke-validation-secret-40',
  REFRESH_TOKEN_PEPPER: 'refresh-pepper-smoke-validation-secret-40',
  APP_ENCRYPTION_KEY: 'app-encryption-smoke-validation-secret-40',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  JOB_WORKER_ENABLED: 'true',
  FRONTEND_URL: 'http://127.0.0.1:3000',
  CORS_ORIGIN: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/api/v1',
  NEXT_PUBLIC_WEBSITE_URL: 'http://127.0.0.1:3000',
  BACKEND_INTERNAL_URL: 'http://backend:3001/api/v1',
};

const tempDir = mkdtempSync(join(tmpdir(), 'itemba-compose-smoke-'));
const envFile = join(tempDir, `${target.name}.env`);
writeFileSync(
  envFile,
  `${Object.entries(sampleEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`,
  'utf8',
);

let shouldPrintDiagnostics = true;
let exitCode = 0;

try {
  await runSmoke();
  shouldPrintDiagnostics = false;
  console.log(`smoke-compose-deployment: OK ${target.name}`);
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

async function runSmoke() {
  console.log(`Starting ${target.name} deployment compose smoke...`);
  compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
  compose(['up', '--build', '-d']);

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

  await waitForHttp(
    'frontend login route',
    'http://127.0.0.1:3000/login',
    180_000,
    async (response) => {
      if (!response.ok) return false;
      const text = await response.text().catch(() => '');
      return text.length > 0;
    },
  );
}

function compose(composeArgs, options = {}) {
  return runDocker(
    [
      'compose',
      '--env-file',
      envFile,
      '-f',
      resolve(rootDir, target.composeFile),
      ...composeArgs,
    ],
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
    throw new Error(`docker ${dockerArgs.join(' ')} failed with exit code ${result.status}`);
  }

  return result;
}

async function waitForHttp(label, url, timeoutMs, predicate) {
  const startedAt = Date.now();
  let lastError = 'not attempted';

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
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
  console.error(`\n${target.name} compose diagnostics:`);
  compose(['ps'], { allowFailure: true });
  compose(
    [
      'logs',
      '--no-color',
      '--tail',
      '180',
      'backend-migrate',
      'backend',
      'frontend',
      'postgres',
      'redis',
    ],
    { allowFailure: true },
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
