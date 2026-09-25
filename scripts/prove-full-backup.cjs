// Run only in the isolated release API image, with /proof mounted to a private
// empty evidence directory. Exercises the actual worker, pg_dump and psql.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const load = createRequire('/app/backend/package.json');
const { PrismaClient } = load('@prisma/client');
const { unzipSync } = load('fflate');
const { BackupRunJobHandler } = load('./dist/modules/job-worker/handlers/backup-run.handler');
const { JobHandlerRegistry } = load('./dist/modules/job-worker/job-handler.registry');

const source = new URL(process.env.DATABASE_URL);
assert.equal(process.env.ITEMBA_FILE_BACKUP_PROOF, '1');
assert.equal(source.hostname, 'postgres');
assert.equal(source.port, '5432');
assert.equal(source.pathname, '/itemba_release_proof');
assert.equal(process.env.STORAGE_LOCAL_PATH, '/proof/storage');
assert.equal(process.env.BACKUPS_DIR, '/proof/backups');
assert.equal(process.env.NODE_ENV, 'test');
delete process.env.EXPORTS_DIR;
const stamp = randomUUID().replaceAll('-', '').slice(0, 12);
const restoredName = `itemba_release_file_restore_${stamp}`;
assert.match(restoredName, /^itemba_release_file_restore_[a-f0-9]{12}$/);
const restoredUrl = new URL(source);
restoredUrl.pathname = '/' + restoredName;
const db = new PrismaClient();
const restored = new PrismaClient({ datasources: { db: { url: restoredUrl.href } } });
const pgArgs = [
  '--host',
  'postgres',
  '--port',
  '5432',
  '--username',
  decodeURIComponent(source.username),
  '--no-password',
];
const pgEnv = { ...process.env, PGPASSWORD: decodeURIComponent(source.password) };
let createdRestore = false;

function pg(args) {
  return execFileSync('psql', [...pgArgs, '--set', 'ON_ERROR_STOP=1', ...args], {
    env: pgEnv,
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function fingerprint(client) {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const tables = await tx.$queryRawUnsafe(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      );
      const result = [];
      for (const { tablename } of tables) {
        // The executing BackupRun changes from RUNNING to COMPLETED after its own
        // database snapshot. Business tables must still match exactly.
        if (tablename === 'backup_runs') continue;
        const quoted = '"' + tablename.replaceAll('"', '""') + '"';
        const rows = await tx.$queryRawUnsafe(
          `SELECT row_to_json(t)::text AS row FROM public.${quoted} t`,
        );
        result.push({
          table: tablename,
          rows: rows.length,
          sha256: createHash('sha256')
            .update(
              rows
                .map(({ row }) => row)
                .sort()
                .join('\n'),
            )
            .digest('hex'),
        });
      }
      return result;
    },
    { isolationLevel: 'RepeatableRead', timeout: 120000 },
  );
}

async function main() {
  const started = Date.now();
  await fs.mkdir('/proof/storage/documents', { recursive: true });
  await fs.mkdir('/proof/backups', { recursive: true });
  const owner = await db.user.findFirstOrThrow({
    where: {
      email: { startsWith: 'finance-', endsWith: '@example.invalid' },
      companyId: { not: null },
    },
  });
  const documents = [];
  for (const [suffix, bytes] of [
    ['invoice.bin', Buffer.from([0, 1, 127, 128, 255, 13, 10])],
    ['letter.txt', Buffer.from('Synthetic Itemba full-backup proof — kiasi 125,000.50.\n')],
  ]) {
    const storageKey = `backup-proof-${stamp}-${suffix}`;
    await fs.writeFile(`/proof/storage/documents/${storageKey}`, bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    const document = await db.document.create({
      data: {
        title: `Synthetic full backup ${stamp}`,
        ownerType: 'COMPANY',
        ownerId: owner.companyId,
        companyId: owner.companyId,
        uploadedById: owner.id,
        fileName: suffix,
        storageKey,
        mimeType: 'application/octet-stream',
        fileSizeBytes: bytes.length,
      },
    });
    documents.push({
      id: document.id,
      storageKey,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const run = await db.backupRun.create({
    data: {
      backupRunNumber: `FULL-PROOF-${stamp}`,
      backupType: 'FULL_SYSTEM',
      status: 'REQUESTED',
      triggeredById: owner.id,
    },
  });
  const before = await fingerprint(db);
  const registry = new JobHandlerRegistry();
  new BackupRunJobHandler(db, registry).onModuleInit();
  await registry.get('BACKUP_RUN')({
    jobId: `proof-${stamp}`,
    jobType: 'BACKUP_RUN',
    companyId: null,
    payload: { backupRunId: run.id },
    correlationId: run.id,
    attempts: 1,
  });
  const finished = await db.backupRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.metadata.artifactFormat, 'itemba-backup/zip-v1');
  assert.equal(finished.metadata.filesIncluded, true);
  assert.equal(finished.metadata.databaseIncluded, true);
  const stat = await fs.stat(finished.filePath);
  assert.ok(
    stat.size < 128 * 1024 * 1024,
    'Synthetic proof only: refuse to load a large/live backup into memory',
  );
  const archiveBytes = await fs.readFile(finished.filePath);
  assert.equal(createHash('sha256').update(archiveBytes).digest('hex'), finished.checksum);
  const archive = unzipSync(archiveBytes);
  const manifest = JSON.parse(Buffer.from(archive['manifest.json']).toString());
  assert.equal(manifest.databaseIncluded, true);
  assert.equal(new Set(manifest.files.map((file) => file.path)).size, manifest.files.length);
  assert.equal(Object.keys(archive).length, manifest.files.length + 1);
  const restoreRoot = `/proof/restored-${stamp}`;
  await fs.mkdir(restoreRoot, { mode: 0o700 });
  for (const file of manifest.files) {
    assert.ok(file.path === 'database.sql' || file.path.startsWith('files/'));
    assert.ok(!file.path.includes('\\') && !file.path.includes(':'));
    assert.ok(file.path.split('/').every((part) => part && part !== '.' && part !== '..'));
    const target = path.resolve(restoreRoot, file.path);
    assert.ok(target.startsWith(restoreRoot + '/'));
    assert.equal(archive[file.path].length, file.bytes);
    assert.equal(createHash('sha256').update(archive[file.path]).digest('hex'), file.sha256);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, archive[file.path], { flag: 'wx', mode: 0o600 });
    assert.equal(
      createHash('sha256')
        .update(await fs.readFile(target))
        .digest('hex'),
      file.sha256,
    );
  }
  // This database name is generated here and checked above; never clean or
  // overwrite an existing database. Only this new database is removed below.
  pg(['--dbname', 'postgres', '--command', `CREATE DATABASE "${restoredName}"`]);
  createdRestore = true;
  const restoreStart = Date.now();
  pg(['--dbname', restoredName, '--single-transaction', '--file', `${restoreRoot}/database.sql`]);
  const after = await fingerprint(restored);
  assert.deepEqual(after, before, 'Restored business rows differ from the source database');
  for (const document of documents) {
    const row = await restored.document.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(row.storageKey, document.storageKey);
    const bytes = await fs.readFile(`${restoreRoot}/files/storage/documents/${row.storageKey}`);
    assert.equal(bytes.length, row.fileSizeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), document.sha256);
  }
  const evidence = {
    createdAt: new Date().toISOString(),
    environment: 'isolated synthetic PostgreSQL and files',
    nodeVersion: process.version,
    backupRunId: run.id,
    archiveSha256: finished.checksum,
    databaseTablesVerified: after.length,
    databaseRowsVerified: after.reduce((sum, table) => sum + table.rows, 0),
    filesRestoredAndHashed: manifest.files.length,
    linkedDocumentsVerified: documents.length,
    restoreSeconds: (Date.now() - restoreStart) / 1000,
    totalSeconds: (Date.now() - started) / 1000,
    databaseContentVerified: true,
    fileContentVerified: true,
    limits: [
      'Worker integration on synthetic data, not production recovery or permission acceptance.',
      'Backup-run bookkeeping is excluded from table equality because the run completes after its own snapshot.',
      'Off-server replication, production-scale timings and secret-store recovery remain operator acceptance gates.',
    ],
  };
  await fs.writeFile('/proof/results.json', JSON.stringify(evidence, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(
    `PASS full backup: ${after.length} tables, ${evidence.databaseRowsVerified} rows, ${manifest.files.length} files restored and hashed; ${documents.length} document references match restored file bytes.`,
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await restored.$disconnect();
    await db.$disconnect();
    if (createdRestore)
      pg(['--dbname', 'postgres', '--command', `DROP DATABASE "${restoredName}"`]);
  });
