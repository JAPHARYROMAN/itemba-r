#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = '../database/prisma/schema.prisma';
const dbUrl = process.env.DATABASE_URL || readEnvFileValue('DATABASE_URL');
const args = process.argv.slice(2);
const skipDbPreflight = process.env.SKIP_E2E_DB_PREFLIGHT === '1';

if (!skipDbPreflight) {
  if (!dbUrl) {
    fail(
      [
        'DATABASE_URL is required for backend e2e tests.',
        'For local Docker development, run:',
        '  docker compose up -d postgres',
        '  $env:DATABASE_URL="postgresql://itemba:itemba_dev_password@localhost:5433/itemba_r?schema=public"',
        '  npx prisma migrate deploy --schema=../database/prisma/schema.prisma',
        '  npm run test:e2e:ci',
      ].join('\n'),
    );
  }

  const endpoint = parseDatabaseEndpoint(dbUrl);
  if (!endpoint) {
    fail('DATABASE_URL must be a valid postgres connection string for backend e2e tests.');
  }

  await assertTcpReachable(endpoint.host, endpoint.port);
  run('npx', ['prisma', 'migrate', 'status', `--schema=${schemaPath}`], {
    DATABASE_URL: dbUrl,
  });
}

const jestArgs = [
  '--max-old-space-size=8192',
  './node_modules/jest/bin/jest.js',
  '--config',
  './test/jest-e2e.json',
  '--runInBand',
  '--ci',
  '--reporters=default',
  '--reporters=summary',
  ...args,
];
const result = spawnSync(process.execPath, jestArgs, {
  cwd: backendDir,
  env: { ...process.env, DATABASE_URL: dbUrl ?? process.env.DATABASE_URL },
  stdio: 'inherit',
  windowsHide: true,
});

process.exit(result.status ?? 1);

function readEnvFileValue(key) {
  const file = resolve(backendDir, '.env');
  if (!existsSync(file)) return undefined;

  const match = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && line.startsWith(`${key}=`));

  if (!match) return undefined;
  return match.slice(key.length + 1).replace(/^["']|["']$/g, '');
}

function parseDatabaseEndpoint(value) {
  try {
    const url = new URL(value);
    if (!url.protocol.startsWith('postgres')) return null;
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
    };
  } catch {
    return null;
  }
}

async function assertTcpReachable(host, port) {
  await new Promise((resolvePromise, rejectPromise) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectPromise(new Error(`timed out connecting to ${host}:${port}`));
    }, 3000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolvePromise();
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
  }).catch((error) => {
    const detail = error.message || error.code || String(error);
    fail(
      [
        `Cannot reach the e2e PostgreSQL database at ${host}:${port}: ${detail}`,
        'Start a disposable database before running backend e2e tests.',
        'Local Docker example:',
        '  docker compose up -d postgres',
        '  $env:DATABASE_URL="postgresql://itemba:itemba_dev_password@localhost:5433/itemba_r?schema=public"',
        '  npx prisma migrate deploy --schema=../database/prisma/schema.prisma',
      ].join('\n'),
    );
  });
}

function run(command, commandArgs, env = {}) {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  const result = spawnSync(executable, commandArgs, {
    cwd: backendDir,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
