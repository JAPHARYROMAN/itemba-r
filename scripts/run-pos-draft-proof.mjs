import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(root, 'backend');
const require = createRequire(resolve(backend, 'package.json'));
const envFile = resolve(root, '.release/rehearsal.env');
mkdirSync(dirname(envFile), { recursive: true });
// CI owns this fresh database. This option never replaces a local rehearsal profile.
if (process.argv.includes('--ci-setup')) {
  assert.equal(process.env.CI, 'true', 'CI setup requires an isolated CI runner');
  assert.ok(!existsSync(envFile), 'Do not replace an existing rehearsal profile');
  const secret = () => randomBytes(32).toString('hex');
  const config = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: 'test',
    PORT: '28001',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '16392',
    REDIS_PASSWORD: '',
    JWT_ACCESS_SECRET: secret(),
    JWT_REFRESH_SECRET: secret(),
    TWO_FACTOR_ENCRYPTION_KEY: secret(),
    REFRESH_TOKEN_PEPPER: secret(),
    APP_ENCRYPTION_KEY: secret(),
    FRONTEND_URL: 'http://localhost:28009',
    CORS_ORIGIN: 'http://localhost:28009',
    RELEASE_PROOF_USER_PASSWORD: secret(),
    MSAIDIZI_ENABLED: 'false',
    MSAIDIZI_AUTONOMY_ENABLED: 'false',
    MSAIDIZI_AUTOPILOT_ENABLED: 'false',
    MSAIDIZI_HOST_EXECUTION_ENABLED: 'false',
    MSAIDIZI_TASK_WORKER_ENABLED: 'false',
    MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'false',
    MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'false',
    MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED: 'false',
    ANTHROPIC_API_KEY: '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
  };
  writeFileSync(
    envFile,
    Object.entries(config)
      .map(([key, value]) => `${key}=${value ?? ''}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
}
const config = require('dotenv').parse(readFileSync(envFile));
const database = new URL(config.DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1', 'Proof database must be loopback');
assert.equal(database.port, '18564', 'Proof database must use its dedicated port');
assert.equal(database.pathname, '/itemba_release_proof', 'Proof database must be isolated');
assert.equal(config.PORT, '28001', 'Proof API must use its dedicated port');
assert.equal(config.NODE_ENV, 'test', 'Proof API must run in test mode');
const environment = { ...process.env, ...config };
async function run(file, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: backend,
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`Proof command exited ${code}`)),
    );
  });
}
await run(resolve(backend, 'node_modules/prisma/build/index.js'), [
  'migrate',
  'deploy',
  '--schema=../database/prisma/schema.prisma',
]);
await new Promise((resume, reject) => {
  const probe = createServer();
  probe.once('error', () =>
    reject(
      new Error('Proof API port is already occupied; stop only the owned rehearsal API first'),
    ),
  );
  probe.listen(28001, '127.0.0.1', () => probe.close(resume));
});
const output = createWriteStream(resolve(root, '.release/pos-proof-api.log'), { mode: 0o600 });
const api = spawn(process.execPath, [resolve(backend, 'dist/main.js')], {
  cwd: backend,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
});
api.stdout.pipe(output);
api.stderr.pipe(output);
let stopped = false;
api.once('exit', () => {
  stopped = true;
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    assert.ok(!stopped, 'Isolated proof API stopped before readiness; inspect its private log');
    try {
      const result = await fetch('http://127.0.0.1:28001/api/v1/health/ready', {
        signal: AbortSignal.timeout(2000),
      });
      if (result.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Starting. */
    }
    await new Promise((resume) => setTimeout(resume, 1000));
  }
  assert.ok(ready, 'Isolated proof API did not become ready');
  await run(resolve(backend, 'scripts/verify-pos-draft-workflows.cjs'), []);
} finally {
  // Stop only the process this runner created, preserving every database and draft.
  if (!stopped) {
    api.kill('SIGTERM');
    await new Promise((resume) => {
      const timer = setTimeout(() => {
        api.kill('SIGKILL');
        resume();
      }, 10000);
      api.once('exit', () => {
        clearTimeout(timer);
        resume();
      });
    });
  }
  output.end();
}
