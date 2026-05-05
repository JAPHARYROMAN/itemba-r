#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2), process.env);
const envFile = options.envFile ?? (options.production ? '.env.production' : '.env.staging');
const envFilePath = resolve(rootDir, envFile);

if (!existsSync(envFilePath)) {
  fail(
    [
      `Live integration env file is missing: ${envFilePath}`,
      `Create it from ${options.production ? '.env.production.example' : '.env.staging.example'} and fill the SMTP_* plus EXTERNAL_SMOKE_EMAIL_TO values.`,
    ].join('\n'),
  );
}

const envValues = loadEnv(envFilePath);
const missing = requiredSmtpKeys(options.verifyOnly).filter((key) => !envValues[key]);

if (missing.length > 0) {
  fail(
    [
      `Live SMTP gate is not configured in ${envFile}: missing ${missing.join(', ')}`,
      'Required minimum live gate: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, and EXTERNAL_SMOKE_EMAIL_TO.',
    ].join('\n'),
  );
}

const childEnv = {
  ...process.env,
  ...envValues,
  EXTERNAL_SMOKE_REQUIRE: mergeList(envValues.EXTERNAL_SMOKE_REQUIRE, ['LIVE', 'SMTP']),
  EXTERNAL_SMOKE_SEND_EMAIL: options.verifyOnly ? 'false' : 'true',
};

const result = spawnSync(
  process.execPath,
  [
    resolve(rootDir, 'scripts/smoke-external-integrations.mjs'),
    '--env-file',
    envFile,
    '--require',
    'LIVE,SMTP',
  ],
  {
    cwd: rootDir,
    env: childEnv,
    stdio: 'inherit',
    windowsHide: true,
  },
);

if (result.error) {
  fail(`Unable to run live integration gate: ${result.error.message}`);
}

process.exit(result.status ?? 1);

function parseArgs(argv, env) {
  const target = String(
    env.npm_config_target || env.npm_config_environment || env.npm_config_env || '',
  ).toLowerCase();
  const parsed = {
    envFile: configValue(env.npm_config_env_file),
    production: target === 'production' || target === 'prod' || bool(env.npm_config_production),
    verifyOnly: bool(env.npm_config_verify_only),
  };

  if (target === 'staging' || target === 'stage' || bool(env.npm_config_staging)) {
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
    if (arg === '--verify-only') {
      parsed.verifyOnly = true;
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

function configValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || ['true', 'false'].includes(normalized.toLowerCase())) return null;
  return normalized;
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

function requiredSmtpKeys(verifyOnly) {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  if (!verifyOnly) keys.push('EXTERNAL_SMOKE_EMAIL_TO');
  return keys;
}

function mergeList(current, required) {
  const values = new Set(
    String(current ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  for (const item of required) values.add(item);
  return [...values].join(',');
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
