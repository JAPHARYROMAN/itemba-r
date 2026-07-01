#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

const targets = [
  {
    name: 'production',
    file: 'docker-compose.production.yml',
    expectedProjectName: 'itemba-r-prod',
    expectedNodeEnv: 'production',
  },
  {
    name: 'staging',
    file: 'docker-compose.staging.yml',
    expectedProjectName: 'itemba-r-staging',
    expectedNodeEnv: 'staging',
  },
].filter((target) => {
  if (args.has('--production-only')) {
    return target.name === 'production';
  }
  if (args.has('--staging-only')) {
    return target.name === 'staging';
  }
  return true;
});

const requiredSecretKeys = [
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'TWO_FACTOR_ENCRYPTION_KEY',
  'REFRESH_TOKEN_PEPPER',
  'APP_ENCRYPTION_KEY',
  'FRONTEND_URL',
  'APP_URL',
  'CORS_ORIGIN',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_WEBSITE_URL',
  'APP_HOST',
  'API_HOST',
  'WEBSITE_HOST',
  'WEBSITE_WWW_HOST',
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD',
];

const sampleEnv = {
  POSTGRES_DB: 'itemba_r_deploy_validation',
  POSTGRES_USER: 'itemba_deploy_validation',
  POSTGRES_PASSWORD: 'postgres-deploy-validation-secret-40',
  REDIS_PASSWORD: 'redis-deploy-validation-secret-40',
  JWT_ACCESS_SECRET: 'jwt-access-deploy-validation-secret-40',
  JWT_REFRESH_SECRET: 'jwt-refresh-deploy-validation-secret-40',
  TWO_FACTOR_ENCRYPTION_KEY: 'two-factor-deploy-validation-secret-40',
  REFRESH_TOKEN_PEPPER: 'refresh-pepper-deploy-validation-secret-40',
  APP_ENCRYPTION_KEY: 'app-encryption-deploy-validation-secret-40',
  FRONTEND_URL: 'https://app.validation.local',
  APP_URL: 'https://app.validation.local',
  CORS_ORIGIN: 'https://app.validation.local',
  NEXT_PUBLIC_API_URL: 'https://api.validation.local/api/v1',
  NEXT_PUBLIC_WEBSITE_URL: 'https://validation.local',
  BACKEND_INTERNAL_URL: 'http://backend:3001/api/v1',
  APP_HOST: 'app.validation.local',
  API_HOST: 'api.validation.local',
  WEBSITE_HOST: 'validation.local',
  WEBSITE_WWW_HOST: 'www.validation.local',
  ACME_EMAIL: 'ops@validation.local',
  JOB_WORKER_ENABLED: 'true',
  SEED_ADMIN_EMAIL: 'admin@validation.local',
  SEED_ADMIN_PASSWORD: 'seed-admin-deploy-validation-secret-40',
  SEED_DEMO_DATA: 'true',
};

const tempDir = mkdtempSync(join(tmpdir(), 'itemba-deploy-validate-'));
const emptyEnvFile = join(tempDir, 'empty.env');
writeFileSync(emptyEnvFile, '', 'utf8');

try {
  for (const target of targets) {
    validateMissingSecretsFail(target);
    const config = validateConfigPasses(target);
    assertDeploymentShape(target, config);
    console.log(`OK ${target.name}: compose fail-fast and deployment shape verified`);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function composeConfig(target, extraEnv = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
  };

  for (const key of requiredSecretKeys) {
    if (!Object.prototype.hasOwnProperty.call(extraEnv, key)) {
      delete env[key];
    }
  }

  return spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      emptyEnvFile,
      '-f',
      resolve(rootDir, target.file),
      '--profile',
      'seed',
      'config',
      '--format',
      'json',
    ],
    {
      cwd: rootDir,
      env,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
}

function validateMissingSecretsFail(target) {
  const result = composeConfig(target);

  if (result.error) {
    fail(`${target.name}: unable to run docker compose: ${result.error.message}`);
  }

  if (result.status === 0) {
    fail(`${target.name}: compose accepted missing required secrets`);
  }
}

function validateConfigPasses(target) {
  const result = composeConfig(target, sampleEnv);

  if (result.error) {
    fail(`${target.name}: unable to run docker compose: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(
      `${target.name}: compose config failed with required secrets supplied\n${result.stderr || result.stdout}`,
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`${target.name}: compose config did not produce valid JSON: ${error.message}`);
  }
}

function assertDeploymentShape(target, config) {
  assertEqual(target, config.name, target.expectedProjectName, 'project name');

  const services = config.services ?? {};
  for (const serviceName of [
    'caddy',
    'postgres',
    'redis',
    'backend-migrate',
    'backend-seed',
    'backend',
    'frontend',
    'website',
  ]) {
    assert(target, services[serviceName], `service "${serviceName}" is present`);
  }

  const caddy = services.caddy;
  const backend = services.backend;
  const migrate = services['backend-migrate'];
  const seed = services['backend-seed'];
  const frontend = services.frontend;
  const website = services.website;
  const redis = services.redis;

  assertEqual(target, migrate.build?.target, 'migration', 'backend-migrate uses migration target');
  assertEqual(target, seed.build?.target, 'migration', 'backend-seed uses migration target');
  assert(
    target,
    flatten(seed.command).includes('npm run db:seed'),
    'backend-seed runs the database seed command',
  );
  assertEqual(target, backend.build?.target, 'production', 'backend uses production target');
  assertEqual(target, frontend.build?.target, 'runner', 'frontend uses runner target');
  assert(target, website.build, 'website has build configuration');

  assertEqual(
    target,
    backend.depends_on?.['backend-migrate']?.condition,
    'service_completed_successfully',
    'backend waits for successful migrations',
  );
  assertEqual(
    target,
    backend.depends_on?.redis?.condition,
    'service_healthy',
    'backend waits for healthy redis',
  );
  assertEqual(
    target,
    frontend.depends_on?.backend?.condition,
    'service_healthy',
    'frontend waits for healthy backend',
  );
  assertEqual(
    target,
    caddy.depends_on?.frontend?.condition,
    'service_healthy',
    'caddy waits for healthy frontend',
  );
  assertEqual(
    target,
    caddy.depends_on?.backend?.condition,
    'service_healthy',
    'caddy waits for healthy backend',
  );
  assertEqual(
    target,
    caddy.depends_on?.website?.condition,
    'service_healthy',
    'caddy waits for healthy website',
  );

  assertEqual(target, backend.environment?.NODE_ENV, target.expectedNodeEnv, 'backend NODE_ENV');
  assertEqual(
    target,
    migrate.environment?.NODE_ENV,
    target.expectedNodeEnv,
    'backend-migrate NODE_ENV',
  );
  assertEqual(target, seed.environment?.NODE_ENV, target.expectedNodeEnv, 'backend-seed NODE_ENV');

  for (const envKey of [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'TWO_FACTOR_ENCRYPTION_KEY',
    'REFRESH_TOKEN_PEPPER',
    'APP_ENCRYPTION_KEY',
    'FRONTEND_URL',
    'APP_URL',
    'CORS_ORIGIN',
    'REDIS_PASSWORD',
  ]) {
    assert(target, migrate.environment?.[envKey], `backend-migrate has ${envKey}`);
    assert(target, seed.environment?.[envKey], `backend-seed has ${envKey}`);
    assert(target, backend.environment?.[envKey], `backend has ${envKey}`);
  }

  for (const envKey of ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_DEMO_DATA']) {
    assert(target, seed.environment?.[envKey], `backend-seed has ${envKey}`);
  }

  for (const envKey of [
    'FRONTEND_URL',
    'APP_URL',
    'CORS_ORIGIN',
    'REDIS_PASSWORD',
    'JOB_WORKER_ENABLED',
    'STORAGE_LOCAL_PATH',
    'BACKUP_STORAGE_PATH',
    'BACKUPS_DIR',
  ]) {
    assert(target, backend.environment?.[envKey], `backend has ${envKey}`);
  }

  for (const envKey of [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'AT_API_KEY',
    'AT_USERNAME',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
  ]) {
    assert(
      target,
      Object.prototype.hasOwnProperty.call(backend.environment ?? {}, envKey),
      `backend declares optional external integration env ${envKey}`,
    );
  }

  const backendVolumes = (backend.volumes ?? []).map((volume) => volume.target ?? '');
  assert(target, backendVolumes.includes('/app/storage'), 'backend mounts persistent file storage');
  assert(target, backendVolumes.includes('/app/backups'), 'backend mounts persistent backups');

  assert(target, redis.environment?.REDIS_PASSWORD, 'redis has password environment');
  assert(
    target,
    flatten(redis.command).includes('--requirepass'),
    'redis requires password at startup',
  );
  assert(
    target,
    flatten(redis.healthcheck?.test).includes('REDISCLI_AUTH'),
    'redis healthcheck authenticates',
  );

  assert(
    target,
    frontend.build?.args?.NEXT_PUBLIC_API_URL,
    'frontend build receives NEXT_PUBLIC_API_URL',
  );
  assert(
    target,
    frontend.build?.args?.NEXT_PUBLIC_WEBSITE_URL,
    'frontend build receives NEXT_PUBLIC_WEBSITE_URL',
  );
  assert(
    target,
    frontend.build?.args?.BACKEND_INTERNAL_URL,
    'frontend build receives BACKEND_INTERNAL_URL',
  );
  assert(target, frontend.environment?.BACKEND_INTERNAL_URL, 'frontend has internal backend URL');
  assert(target, frontend.environment?.NEXT_PUBLIC_API_URL, 'frontend has public API URL');
  assert(target, frontend.environment?.NEXT_PUBLIC_WEBSITE_URL, 'frontend has public website URL');
  assert(target, caddy.environment?.APP_HOST, 'caddy has frontend hostname');
  assert(target, caddy.environment?.API_HOST, 'caddy has API hostname');
  assert(target, caddy.environment?.WEBSITE_HOST, 'caddy has website hostname');
  assert(target, caddy.environment?.WEBSITE_WWW_HOST, 'caddy has website www hostname');
  assert(target, caddy.environment?.ACME_EMAIL, 'caddy has ACME email');

  const caddyPorts = (caddy.ports ?? []).map((port) =>
    String(port.published ?? port.target ?? port),
  );
  assert(target, caddyPorts.includes('80'), 'caddy publishes HTTP port 80');
  assert(target, caddyPorts.includes('443'), 'caddy publishes HTTPS port 443');
  assert(target, !(backend.ports ?? []).length, 'backend does not publish a public port');
  assert(target, !(frontend.ports ?? []).length, 'frontend does not publish a public port');
  assert(
    target,
    (backend.expose ?? []).map(String).includes('3001'),
    'backend exposes port 3001 internally',
  );
  assert(
    target,
    (frontend.expose ?? []).map(String).includes('3000'),
    'frontend exposes port 3000 internally',
  );
  assert(
    target,
    (website.expose ?? []).map(String).includes('3001'),
    'website exposes port 3001 internally',
  );

  for (const serviceName of ['caddy', 'postgres', 'redis', 'backend', 'frontend', 'website']) {
    assert(target, services[serviceName].healthcheck?.test, `${serviceName} has a healthcheck`);
  }

  const backendHealthcheck = flatten(backend.healthcheck?.test);
  assert(
    target,
    backendHealthcheck.includes('node -e') && backendHealthcheck.includes('fetch('),
    'backend healthcheck uses Node fetch',
  );
  assert(
    target,
    backendHealthcheck.includes('/api/v1/health/ready'),
    'backend healthcheck probes the readiness endpoint',
  );

  const frontendHealthcheck = flatten(frontend.healthcheck?.test);
  assert(
    target,
    frontendHealthcheck.includes('node -e') && frontendHealthcheck.includes('fetch('),
    'frontend healthcheck uses Node fetch',
  );
  assert(
    target,
    frontendHealthcheck.includes('127.0.0.1:3000/api/health'),
    'frontend healthcheck probes the dedicated health route',
  );

  const websiteHealthcheck = flatten(website.healthcheck?.test);
  assert(
    target,
    websiteHealthcheck.includes('node -e') && websiteHealthcheck.includes('fetch('),
    'website healthcheck uses Node fetch',
  );
  assert(
    target,
    websiteHealthcheck.includes('127.0.0.1:3001/api/health'),
    'website healthcheck probes the dedicated health route',
  );

  const caddyHealthcheck = flatten(caddy.healthcheck?.test);
  assert(
    target,
    caddyHealthcheck.includes('wget -qO-') &&
      caddyHealthcheck.includes('127.0.0.1:2019/config'),
    'caddy healthcheck probes the admin config endpoint',
  );
}

function flatten(value) {
  if (Array.isArray(value)) {
    return value.join(' ');
  }
  return String(value ?? '');
}

function assertEqual(target, actual, expected, label) {
  assert(target, actual === expected, `${label}: expected ${expected}, got ${actual}`);
}

function assert(target, condition, label) {
  if (!condition) {
    fail(`${target.name}: ${label}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
