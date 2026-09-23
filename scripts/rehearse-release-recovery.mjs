import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'backend/package.json'));
const { PrismaClient } = require('@prisma/client');
const env = Object.fromEntries(
  readFileSync(resolve(root, '.release/rehearsal.env'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const source = new URL(env.DATABASE_URL);
assert.equal(source.hostname, '127.0.0.1');
assert.equal(source.port, '5549');
assert.equal(source.pathname, '/itemba_release_proof');
const restoredName = `itemba_release_restore_${Date.now()}`;
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
  const result = spawnSync('docker', [...compose, 'exec', '-T', 'postgres', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Recovery command failed: ${result.error?.message || result.stderr}`);
  return result.stdout;
}
async function fingerprint(url) {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const tables = await tx.$queryRawUnsafe(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        );
        const result = [];
        for (const { tablename } of tables) {
          // Identifiers originate from pg_catalog and are quoted, never from user input.
          const quoted = '"' + tablename.replaceAll('"', '""') + '"';
          const rows = await tx.$queryRawUnsafe(
            `SELECT row_to_json(t)::text AS row FROM public.${quoted} t`,
          );
          const canonical = rows.map(({ row }) => row).sort();
          result.push({
            table: tablename,
            rows: canonical.length,
            sha256: createHash('sha256').update(canonical.join('\n')).digest('hex'),
          });
        }
        return result;
      },
      { isolationLevel: 'RepeatableRead', timeout: 120000 },
    );
  } finally {
    await db.$disconnect();
  }
}
const start = Date.now();
const before = await fingerprint(source.href);
const dumpPath = '/tmp/itemba-release-proof.dump';
docker([
  'pg_dump',
  '-U',
  'itemba_proof',
  '-d',
  'itemba_release_proof',
  '-Fc',
  '--no-owner',
  '-f',
  dumpPath,
]);
const backedUpAt = new Date().toISOString();
// A new database is created for every rehearsal. No drop/clean command is used.
docker(['createdb', '-U', 'itemba_proof', restoredName]);
const restoreStarted = Date.now();
docker([
  'pg_restore',
  '-U',
  'itemba_proof',
  '-d',
  restoredName,
  '--no-owner',
  '--exit-on-error',
  dumpPath,
]);
const restoreSeconds = (Date.now() - restoreStarted) / 1000;
const restored = new URL(source);
restored.pathname = '/' + restoredName;
const after = await fingerprint(restored.href);
assert.deepEqual(
  after,
  before,
  'Restored table contents differ from the source snapshot; check for concurrent writes.',
);
const result = {
  createdAt: new Date().toISOString(),
  environment: 'isolated local PostgreSQL rehearsal',
  sourceDatabase: source.pathname.slice(1),
  restoredDatabase: restoredName,
  backedUpAt,
  restoreSeconds,
  totalSeconds: (Date.now() - start) / 1000,
  tables: after.length,
  rows: after.reduce((sum, t) => sum + t.rows, 0),
  contentVerified: true,
  tableEvidence: after,
  limits: [
    'Database only: uploaded files and object storage still need restoration proof.',
    'Local restore timings are not a production RTO or backup-age guarantee.',
    'Application cutover, remote monitoring and alert delivery remain acceptance checks.',
  ],
};
writeFileSync(resolve(root, '.release/recovery.json'), JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      tables: result.tables,
      rows: result.rows,
      contentVerified: true,
      restoreSeconds,
      restoredDatabase: restoredName,
    },
    null,
    2,
  ),
);
