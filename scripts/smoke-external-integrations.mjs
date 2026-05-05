#!/usr/bin/env node

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromBackend = createRequire(resolve(rootDir, 'backend/package.json'));
const nodemailer = requireFromBackend('nodemailer');

const options = parseArgs(process.argv.slice(2));
const env = loadEnv(options.envFile);
const requireSet = new Set(
  splitList(env.EXTERNAL_SMOKE_REQUIRE)
    .concat(options.require)
    .map((value) => value.toUpperCase()),
);

const results = [];

await runSmtpSmoke();
await runHttpTargetSmoke();
inspectKnownProviderCredentials();

const passed = results.filter((result) => result.status === 'PASS');
const failed = results.filter((result) => result.status === 'FAIL');
const requiredFailures = requiredProviders().filter(
  (name) => !results.some((result) => result.provider === name && result.status === 'PASS'),
);

for (const result of results) {
  const suffix = result.detail ? `: ${result.detail}` : '';
  console.log(`${result.status} ${result.provider}${suffix}`);
}

if (failed.length > 0) {
  fail(`${failed.length} external integration smoke check(s) failed.`);
}

if (requiredFailures.length > 0) {
  fail(`Required external integration(s) did not pass: ${requiredFailures.join(', ')}`);
}

if (requireSet.has('LIVE') && passed.length === 0) {
  fail('EXTERNAL_SMOKE_REQUIRE includes LIVE, but no live external integration passed.');
}

console.log(
  `smoke-external-integrations: OK (${passed.length} passed, ${
    results.filter((result) => result.status === 'SKIP').length
  } skipped)`,
);

async function runSmtpSmoke() {
  const host = env.SMTP_HOST;
  if (!host) {
    record('SMTP', 'SKIP', 'SMTP_HOST is not configured');
    return;
  }

  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port <= 0) {
    record('SMTP', 'FAIL', `SMTP_PORT is invalid: ${env.SMTP_PORT}`);
    return;
  }
  if ((env.SMTP_USER && !env.SMTP_PASS) || (!env.SMTP_USER && env.SMTP_PASS)) {
    record('SMTP', 'FAIL', 'SMTP_USER and SMTP_PASS must be configured together');
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: bool(env.SMTP_SECURE),
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });

  try {
    await transporter.verify();
    const to = env.EXTERNAL_SMOKE_EMAIL_TO;
    if (bool(env.EXTERNAL_SMOKE_SEND_EMAIL)) {
      if (!to) {
        record('SMTP', 'FAIL', 'EXTERNAL_SMOKE_SEND_EMAIL=true requires EXTERNAL_SMOKE_EMAIL_TO');
        return;
      }
      await transporter.sendMail({
        from: env.SMTP_FROM || env.SMTP_USER || 'noreply@itemba.local',
        to,
        subject: `ITEMBA-R external integration smoke ${new Date().toISOString()}`,
        text: 'This is an ITEMBA-R deployment smoke email. If you did not expect it, check the deployment smoke configuration.',
      });
      record('SMTP', 'PASS', `verified credentials and sent email to ${to}`);
      return;
    }
    record('SMTP', 'PASS', `verified SMTP server ${host}:${port}`);
  } catch (error) {
    record('SMTP', 'FAIL', error instanceof Error ? error.message : String(error));
  } finally {
    transporter.close();
  }
}

async function runHttpTargetSmoke() {
  const targets = parseHttpTargets(env.EXTERNAL_SMOKE_HTTP_TARGETS);
  if (targets.length === 0) {
    record('HTTP_TARGETS', 'SKIP', 'EXTERNAL_SMOKE_HTTP_TARGETS is not configured');
    return;
  }

  for (const target of targets) {
    const name = String(target.name || target.url || 'HTTP_TARGET').toUpperCase();
    if (!target.url) {
      record(name, 'FAIL', 'target.url is required');
      continue;
    }

    const headers = {
      ...asRecord(target.headers),
      ...headersFromEnv(asRecord(target.headersFromEnv)),
    };
    const method = String(target.method || 'GET').toUpperCase();
    const expectedStatuses = expectedStatusSet(target.expectedStatuses ?? target.expectedStatus);
    const timeoutMs = positiveNumber(target.timeoutMs, 10_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(String(target.url), {
        method,
        headers,
        signal: controller.signal,
      });
      if (!isExpectedStatus(response.status, expectedStatuses)) {
        const body = await response.text().catch(() => '');
        record(name, 'FAIL', `HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
        continue;
      }
      record(name, 'PASS', `${method} ${target.url} returned HTTP ${response.status}`);
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? `timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      record(name, 'FAIL', message);
    } finally {
      clearTimeout(timer);
    }
  }
}

function inspectKnownProviderCredentials() {
  const known = [
    {
      provider: 'AFRICAS_TALKING_SMS',
      keys: ['AT_API_KEY', 'AT_USERNAME'],
      note: 'credentials are present, but the app has no built-in SMS dispatch adapter yet',
    },
    {
      provider: 'MPESA',
      keys: ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET'],
      note: 'credentials are present, but the app has no built-in M-Pesa payment adapter yet',
    },
    {
      provider: 'TIGOPESA',
      keys: ['TIGOPESA_USERNAME', 'TIGOPESA_PASSWORD'],
      note: 'credentials are present, but the app has no built-in Tigo Pesa payment adapter yet',
    },
    {
      provider: 'AIRTEL_MONEY',
      keys: ['AIRTEL_CLIENT_ID', 'AIRTEL_CLIENT_SECRET'],
      note: 'credentials are present, but the app has no built-in Airtel Money payment adapter yet',
    },
  ];

  for (const item of known) {
    const present = item.keys.filter((key) => Boolean(env[key]));
    if (present.length === 0) {
      record(item.provider, 'SKIP', `${item.keys.join(', ')} not configured`);
      continue;
    }
    if (present.length !== item.keys.length) {
      record(
        item.provider,
        'FAIL',
        `partial credentials configured; missing ${item.keys
          .filter((key) => !env[key])
          .join(', ')}`,
      );
      continue;
    }
    record(item.provider, 'SKIP', item.note);
  }
}

function parseHttpTargets(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      fail('EXTERNAL_SMOKE_HTTP_TARGETS must be a JSON array.');
    }
    return parsed;
  } catch (error) {
    fail(`EXTERNAL_SMOKE_HTTP_TARGETS is not valid JSON: ${error.message}`);
  }
}

function headersFromEnv(mapping) {
  return Object.fromEntries(
    Object.entries(mapping)
      .map(([header, envKey]) => [header, env[String(envKey)]])
      .filter(([, value]) => Boolean(value)),
  );
}

function parseArgs(argv) {
  const parsed = { envFile: null, require: [] };
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
    if (arg === '--require') {
      parsed.require.push(...splitList(argv[index + 1]));
      index += 1;
      continue;
    }
    if (arg.startsWith('--require=')) {
      parsed.require.push(...splitList(arg.slice('--require='.length)));
      continue;
    }
    if (!arg.startsWith('--') && !parsed.envFile) {
      parsed.envFile = arg;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function loadEnv(envFile) {
  const values = {};
  if (envFile) {
    const file = resolve(rootDir, envFile);
    if (!existsSync(file)) fail(`Env file does not exist: ${file}`);
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
  }
  return { ...values, ...process.env };
}

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function expectedStatusSet(value) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const statuses = values
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 100 && item <= 599);
  return statuses.length > 0 ? new Set(statuses) : null;
}

function isExpectedStatus(status, expectedStatuses) {
  if (expectedStatuses) return expectedStatuses.has(status);
  return status >= 200 && status < 400;
}

function requiredProviders() {
  return [...requireSet].filter((name) => name !== 'LIVE');
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function bool(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function record(provider, status, detail) {
  results.push({ provider, status, detail });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
