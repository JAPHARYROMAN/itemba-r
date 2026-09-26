#!/usr/bin/env node
/**
 * Runs the Playwright suite (playwright.config.ts has no webServer on purpose).
 *
 * - BASE_URL set: run the tests against that server as-is.
 * - BASE_URL unset: serve the current build the way the Dockerfile runner
 *   does (public/ and .next/static copied beside .next/standalone/server.js,
 *   NODE_ENV=production) on port 3191 with a throwaway ENQUIRY_STORAGE_DIR,
 *   wait for /api/health, run the tests, then stop the server.
 *
 * Extra arguments pass through: npm run test:e2e -- --project=phone
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const args = process.argv.slice(2);
const PORT = Number(process.env.E2E_PORT || 3191);

function runPlaywright(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [playwrightCli, 'test', ...args], { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForHealth(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  if (process.env.BASE_URL) {
    process.exit(await runPlaywright(process.env));
  }

  const standalone = path.join(root, '.next', 'standalone');
  if (!existsSync(path.join(standalone, 'server.js'))) {
    console.error('[e2e] .next/standalone/server.js not found. Run `npm run build` first, or set BASE_URL.');
    process.exit(1);
  }
  if (await portInUse(PORT)) {
    console.error(`[e2e] Port ${PORT} is already in use. Stop that server, or set BASE_URL to test it.`);
    process.exit(1);
  }

  // Same layout as the Dockerfile runner stage.
  cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true, force: true });
  cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true, force: true });

  const storage = mkdtempSync(path.join(os.tmpdir(), 'itemba-e2e-enquiries-'));
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: standalone,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      ENQUIRY_STORAGE_DIR: storage,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  const stop = () => {
    if (server.exitCode === null) server.kill();
    rmSync(storage, { recursive: true, force: true });
  };
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });

  if (!(await waitForHealth(baseUrl))) {
    console.error(`[e2e] Standalone server did not become healthy on ${baseUrl}.\n${serverLog}`);
    stop();
    process.exit(1);
  }
  console.log(`[e2e] Serving .next/standalone on ${baseUrl} (ENQUIRY_STORAGE_DIR=${storage})`);
  const code = await runPlaywright({ ...process.env, BASE_URL: baseUrl, E2E_ENQUIRY_STORAGE_DIR: storage });
  stop();
  process.exit(code);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
