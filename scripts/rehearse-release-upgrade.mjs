import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const database = `itemba_release_upgrade_${Date.now()}`;
const target = new URL(source);
target.pathname = '/' + database;
const created = spawnSync(
  'docker',
  [
    'compose',
    '--project-name',
    'itemba-os-release',
    '--env-file',
    '.release/rehearsal.env',
    '-f',
    'docker-compose.release-proof.yml',
    'exec',
    '-T',
    'postgres',
    'createdb',
    '-U',
    'itemba_proof',
    database,
  ],
  { cwd: root, encoding: 'utf8' },
);
if (created.status !== 0) throw new Error(created.stderr);
const prefix = resolve(root, '.release', database);
mkdirSync(resolve(prefix, 'migrations'), { recursive: true });
cpSync(resolve(root, 'database/prisma/schema.prisma'), resolve(prefix, 'schema.prisma'));
cpSync(
  resolve(root, 'database/prisma/migrations/migration_lock.toml'),
  resolve(prefix, 'migrations/migration_lock.toml'),
);
const migrations = readdirSync(resolve(root, 'database/prisma/migrations'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const pending = migrations.filter((name) => name >= '20260919120000_cash_ledger_connections');
assert.deepEqual(pending, [
  '20260919120000_cash_ledger_connections',
  '20260919140000_loan_financial_lifecycle',
  '20260919160000_payroll_cash_connection',
  '20260920120000_private_desktop_workspace',
  '20260923150000_mobile_pos_price_overrides',
  '20260923170000_mobile_pos_day_report_price_changes',
  '20260924090000_mobile_pos_price_edit_permissions',
  '20260925110000_records',
  '20260925160000_record_statements',
]);
for (const name of migrations.filter((name) => !pending.includes(name)))
  cpSync(resolve(root, 'database/prisma/migrations', name), resolve(prefix, 'migrations', name), {
    recursive: true,
  });
function migrate(schema, label) {
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: target.href },
      encoding: 'utf8',
      timeout: 240000,
    },
  );
  writeFileSync(
    resolve(root, `.release/upgrade-${label}.log`),
    result.stdout + '\n' + result.stderr,
  );
  if (result.error || result.status !== 0)
    throw new Error(`Upgrade ${label} failed; inspect private migration log.`);
  return result.stdout;
}
migrate(resolve(prefix, 'schema.prisma'), 'predecessor');
const db = new PrismaClient({ datasources: { db: { url: target.href } } });
try {
  const group = await db.group.create({ data: { code: 'UPGRADE', name: 'Synthetic predecessor' } });
  const company = await db.company.create({
    data: { groupId: group.id, code: 'UPGRADE', name: 'Synthetic predecessor company' },
  });
  // The predecessor has no ledgerAccountId column, so use an explicit insert/select.
  await db.$executeRaw`INSERT INTO cash_accounts (id,"companyId","accountName","openingBalance","currentBalance","updatedAt") VALUES ('upgrade-cash',${company.id},'Existing bank',1250.25,1000.25,NOW())`;
  const before =
    await db.$queryRaw`SELECT id,"companyId","accountName","openingBalance"::text,"currentBalance"::text FROM cash_accounts WHERE id='upgrade-cash'`;
  // Exercise the statement upgrade with an actual pre-statement debt and partial payment balance.
  for (const name of pending.filter((name) => name !== '20260925160000_record_statements'))
    cpSync(resolve(root, 'database/prisma/migrations', name), resolve(prefix, 'migrations', name), {
      recursive: true,
    });
  migrate(resolve(prefix, 'schema.prisma'), 'pre-statement');
  const owner = await db.user.create({
    data: {
      email: 'upgrade-records@example.invalid',
      fullName: 'Upgrade fixture',
      passwordHash: 'no-login',
    },
  });
  await db.$executeRaw`INSERT INTO record_entries (id,"requestId","payloadKey","ownerId",kind,title,currency,amount,"settledAmount","recordDate",version,"updatedAt") VALUES ('upgrade-debtor','upgrade-request','fixture',${owner.id},'DEBTOR','Existing partial debt','TZS',100,25,'2026-01-01',2,NOW())`;
  migrate(resolve(root, 'database/prisma/schema.prisma'), 'current');
  const after =
    await db.$queryRaw`SELECT id,"companyId","accountName","openingBalance"::text,"currentBalance"::text FROM cash_accounts WHERE id='upgrade-cash'`;
  assert.deepEqual(after, before, 'Upgrade rewrote the existing cash position.');
  const cash = await db.cashAccount.findUniqueOrThrow({ where: { id: 'upgrade-cash' } });
  assert.equal(cash.ledgerAccountId, null, 'Upgrade must not infer an opening ledger mapping.');
  const entry = await db.recordEntry.findUniqueOrThrow({ where: { id: 'upgrade-debtor' } });
  assert.equal(entry.amount.toString(), '100');
  assert.equal(entry.settledAmount.toString(), '25');
  assert.ok(entry.statementStartsOn, 'Existing debt requires an explicit statement cutover date.');
  const postings = await db.recordPosting.findMany({ where: { recordId: entry.id } });
  assert.equal(postings.length, 1);
  assert.equal(postings[0].kind, 'OPENING');
  assert.equal(postings[0].delta.toString(), '75');
  assert.match(
    migrate(resolve(root, 'database/prisma/schema.prisma'), 'idempotent'),
    /No pending migrations/,
  );
  writeFileSync(
    resolve(root, '.release/upgrade.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        database,
        predecessorMigrations: migrations.length - pending.length,
        applied: pending,
        existingCashPreserved: true,
        unmappedOpeningPreserved: true,
        existingRecordsBalancePreserved: true,
        recordsStatementOpeningVerified: true,
        idempotent: true,
        limit:
          'Synthetic predecessor fixture; a sanitized copy of the release database is still required.',
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${pending.length} release migrations, preserved predecessor balance and repeat deployment.`,
  );
} finally {
  await db.$disconnect();
}
