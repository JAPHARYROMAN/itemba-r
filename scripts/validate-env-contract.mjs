#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const envFiles = [
  { name: 'production', file: '.env.production.example' },
  { name: 'staging', file: '.env.staging.example' },
];

const requiredKeys = [
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'TWO_FACTOR_ENCRYPTION_KEY',
  'REFRESH_TOKEN_PEPPER',
  'APP_ENCRYPTION_KEY',
  'JWT_ACCESS_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'JOB_WORKER_ENABLED',
  'FRONTEND_URL',
  'CORS_ORIGIN',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_WEBSITE_URL',
  'BACKEND_INTERNAL_URL',
];

const secretKeys = [
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'TWO_FACTOR_ENCRYPTION_KEY',
  'REFRESH_TOKEN_PEPPER',
  'APP_ENCRYPTION_KEY',
];

const forbiddenExampleValues = new Set([
  'change-me',
  'changeme',
  'password',
  'secret',
  'dev-secret',
  'itemba-r-jwt-access-secret',
  'itemba-r-jwt-refresh-secret',
  'itemba-r-2fa-key-change-in-prod!',
]);

const parsed = envFiles.map((target) => ({
  ...target,
  values: parseEnvExample(resolve(rootDir, target.file)),
}));

for (const target of parsed) {
  validateRequiredKeys(target);
  validateSecretPlaceholders(target);
  validateBackendInternalUrl(target);
}

validateSameContract(parsed);
console.log('validate-env-contract: OK');

function parseEnvExample(file) {
  const values = new Map();
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      fail(`${file}: invalid env line without "=": ${line}`);
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (!key) fail(`${file}: empty env key`);
    if (values.has(key)) fail(`${file}: duplicate env key ${key}`);
    values.set(key, value);
  }

  return values;
}

function validateRequiredKeys(target) {
  const missing = requiredKeys.filter((key) => !target.values.has(key));
  if (missing.length > 0) {
    fail(`${target.name}: missing required env keys: ${missing.join(', ')}`);
  }
}

function validateSecretPlaceholders(target) {
  for (const key of secretKeys) {
    const value = target.values.get(key) ?? '';
    const normalized = value.toLowerCase().trim();
    if (forbiddenExampleValues.has(normalized)) {
      fail(`${target.name}: ${key} uses a forbidden placeholder value`);
    }
  }
}

function validateBackendInternalUrl(target) {
  const value = target.values.get('BACKEND_INTERNAL_URL');
  if (!value?.endsWith('/api/v1')) {
    fail(`${target.name}: BACKEND_INTERNAL_URL must include the /api/v1 prefix`);
  }
}

function validateSameContract(targets) {
  const [first, ...rest] = targets;
  const firstKeys = [...first.values.keys()].sort();

  for (const target of rest) {
    const keys = [...target.values.keys()].sort();
    const onlyInFirst = firstKeys.filter((key) => !target.values.has(key));
    const onlyInTarget = keys.filter((key) => !first.values.has(key));
    if (onlyInFirst.length > 0 || onlyInTarget.length > 0) {
      fail(
        [
          `${target.name}: env contract differs from ${first.name}`,
          onlyInFirst.length ? `  missing from ${target.name}: ${onlyInFirst.join(', ')}` : '',
          onlyInTarget.length ? `  only in ${target.name}: ${onlyInTarget.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
