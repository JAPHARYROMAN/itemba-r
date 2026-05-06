#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2), process.env);
const envFile = options.envFile ?? (options.production ? '.env.production' : '.env.staging');
const envPath = resolve(rootDir, envFile);

if (!existsSync(envPath)) {
  fail(`Public deployment env file is missing: ${envPath}`);
}

const env = loadEnv(envPath);
const errors = [];

const frontendUrl = requiredUrl('FRONTEND_URL', { originOnly: true, publicHttps: true });
const apiUrl = requiredUrl('NEXT_PUBLIC_API_URL', {
  requireApiPrefix: true,
  publicHttps: true,
});
const websiteUrl = requiredUrl('NEXT_PUBLIC_WEBSITE_URL', {
  originOnly: true,
  publicHttps: true,
});
validateCorsOrigin(frontendUrl);
validateBackendInternalUrl();
validateDomainEmail();

if (errors.length > 0) {
  fail([`validate-public-env: ${envFile} is not ready for public deployment`, ...errors].join('\n'));
}

console.log(
  `validate-public-env: OK ${envFile} (${frontendUrl.origin}, ${apiUrl.origin}${apiUrl.pathname}, ${websiteUrl.origin})`,
);

function parseArgs(argv, processEnv) {
  const target = String(
    processEnv.npm_config_target || processEnv.npm_config_environment || processEnv.npm_config_env || '',
  ).toLowerCase();
  const parsed = {
    envFile: configValue(processEnv.npm_config_env_file),
    production: target === 'production' || target === 'prod' || bool(processEnv.npm_config_production),
  };

  if (target === 'staging' || target === 'stage' || bool(processEnv.npm_config_staging)) {
    parsed.production = false;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--staging') {
      parsed.production = false;
      continue;
    }
    if (arg === '--production') {
      parsed.production = true;
      continue;
    }
    if (arg === '--env-file') {
      parsed.envFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      parsed.envFile = arg.slice('--env-file='.length);
      continue;
    }
    if (!arg.startsWith('--')) {
      const normalized = arg.trim().toLowerCase();
      if (normalized === 'production' || normalized === 'prod') {
        parsed.production = true;
        continue;
      }
      if (normalized === 'staging' || normalized === 'stage') {
        parsed.production = false;
        continue;
      }
      if (!parsed.envFile) {
        parsed.envFile = arg;
        continue;
      }
    }
    fail(`Unknown argument: ${arg}`);
  }

  return parsed;
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

function requiredUrl(key, { originOnly = false, requireApiPrefix = false, publicHttps = false }) {
  const value = env[key];
  if (!value) {
    errors.push(`- ${key} is required`);
    return new URL('https://invalid.example');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`- ${key} must be a valid absolute URL`);
    return new URL('https://invalid.example');
  }

  if (publicHttps) validatePublicHttpsUrl(key, parsed);
  if (originOnly && (parsed.pathname !== '/' || parsed.search || parsed.hash)) {
    errors.push(`- ${key} must be an origin only, for example https://app.example.com`);
  }
  if (requireApiPrefix && !parsed.pathname.replace(/\/$/, '').endsWith('/api/v1')) {
    errors.push(`- ${key} must include the /api/v1 API prefix`);
  }

  return parsed;
}

function validateCorsOrigin(frontendUrl) {
  const value = env.CORS_ORIGIN;
  if (!value) {
    errors.push('- CORS_ORIGIN is required');
    return;
  }

  const origins = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    errors.push('- CORS_ORIGIN must include at least the frontend origin');
    return;
  }

  const parsedOrigins = [];
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      validatePublicHttpsUrl('CORS_ORIGIN', parsed);
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
        errors.push(`- CORS_ORIGIN entries must be origins only: ${origin}`);
      }
      parsedOrigins.push(parsed.origin);
    } catch {
      errors.push(`- CORS_ORIGIN contains an invalid URL: ${origin}`);
    }
  }

  if (!parsedOrigins.includes(frontendUrl.origin)) {
    errors.push(`- CORS_ORIGIN must include FRONTEND_URL origin (${frontendUrl.origin})`);
  }
}

function validateBackendInternalUrl() {
  const value = env.BACKEND_INTERNAL_URL;
  if (!value) {
    errors.push('- BACKEND_INTERNAL_URL is required');
    return;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push('- BACKEND_INTERNAL_URL must be a valid absolute URL');
    return;
  }

  if (!parsed.pathname.replace(/\/$/, '').endsWith('/api/v1')) {
    errors.push('- BACKEND_INTERNAL_URL must include the /api/v1 API prefix');
  }
}

function validateDomainEmail() {
  const from = env.SMTP_FROM;
  if (!from) {
    errors.push('- SMTP_FROM is required and should use the deployment domain');
    return;
  }

  const match = /^[^@\s]+@([^@\s]+)$/.exec(from);
  if (!match) {
    errors.push('- SMTP_FROM must be a valid email address');
    return;
  }

  const domain = match[1].toLowerCase();
  const disallowedDomains = new Set([
    'example.com',
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'yahoo.com',
  ]);

  if (disallowedDomains.has(domain)) {
    errors.push('- SMTP_FROM must use the organization domain, not a placeholder or personal mailbox domain');
  }
  if (isReservedHostname(domain)) {
    errors.push('- SMTP_FROM must use a real organization domain, not a reserved placeholder domain');
  }
}

function validatePublicHttpsUrl(key, url) {
  if (url.protocol !== 'https:') {
    errors.push(`- ${key} must use https`);
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost') ||
    isReservedHostname(hostname) ||
    /^[0-9.]+$/.test(hostname)
  ) {
    errors.push(`- ${key} must use a public DNS hostname, not ${url.hostname}`);
  }
}

function isReservedHostname(hostname) {
  return (
    hostname === 'example' ||
    hostname.endsWith('.example') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.invalid')
  );
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
