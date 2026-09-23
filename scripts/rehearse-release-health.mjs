import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = readFileSync(resolve(root, '.release/rehearsal.env'), 'utf8');
const database = new URL(config.match(/^DATABASE_URL=(.*)$/m)[1].trim());
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '5549');
assert.equal(database.pathname, '/itemba_release_proof');
const compose = [
  'compose',
  '--project-name',
  'itemba-os-release',
  '--env-file',
  '.release/rehearsal.env',
  '-f',
  'docker-compose.release-proof.yml',
];
function docker(args) {
  const result = spawnSync('docker', [...compose, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Rehearsal container action failed: ${result.error?.message || result.stderr}`);
}
async function status(path) {
  const result = await fetch(`http://127.0.0.1:3114/api/v1/health${path}`, {
    signal: AbortSignal.timeout(30000),
  });
  await result.text();
  return result.status;
}
const before = await status('/ready');
assert.equal(before, 200);
let during, live;
try {
  // Targets only the named rehearsal project, never the working/staging service.
  docker(['stop', 'postgres']);
  during = await status('/ready');
  live = await status('/live');
} finally {
  docker(['up', '-d', '--wait', 'postgres']);
}
const after = await status('/ready');
const result = {
  createdAt: new Date().toISOString(),
  before,
  duringDatabaseOutage: during,
  livenessDuringOutage: live,
  afterRestore: after,
  limits: 'Local health-code recovery only. External alert delivery is not verified.',
};
writeFileSync(resolve(root, '.release/health-recovery.json'), JSON.stringify(result, null, 2));
assert.equal(during, 503, 'Readiness must fail when the database is unavailable.');
assert.equal(live, 200, 'Process liveness must remain distinct from database readiness.');
assert.equal(after, 200, 'Readiness must recover after the database returns.');
console.log(JSON.stringify(result, null, 2));
