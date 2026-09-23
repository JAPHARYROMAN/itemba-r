// Runs only against a new disposable database on the configured local PostgreSQL server.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const backend = path.resolve(__dirname, '..');
const schema = path.resolve(backend, '../database/prisma/schema.prisma');
const migration = path.resolve(
  backend,
  '../database/prisma/migrations/20260919140000_loan_financial_lifecycle/migration.sql',
);
function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: backend,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(Error('Proof command failed with exit ' + code)),
    );
  });
}
async function main() {
  const source = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(source.hostname))
    throw Error(
      'Proof runner requires local PostgreSQL. It never runs against the application database.',
    );
  const name = 'itemba_loan_proof_' + randomUUID().replaceAll('-', '');
  source.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: source.href } } });
  let owned = false;
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE ' + name);
    owned = true;
    source.pathname = '/' + name;
    const env = { ...process.env, DATABASE_URL: source.href, LOAN_PROOF_DATABASE_URL: source.href };
    await run(
      [
        path.resolve(backend, 'node_modules/prisma/build/index.js'),
        'db',
        'push',
        '--schema=' + schema,
        '--skip-generate',
      ],
      env,
    );
    const proof = new PrismaClient({ datasources: { db: { url: source.href } } });
    try {
      // Reconstruct the immediately preceding shape, then exercise the actual additive migration.
      await proof.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('DROP TABLE loan_financial_events');
        await tx.$executeRawUnsafe(
          'ALTER TABLE loans DROP COLUMN "fundingMode", DROP COLUMN "principalLedgerAccountId" CASCADE',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE cash_desk_loans DROP COLUMN "receivableAccountId", DROP COLUMN "payableAccountId"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE cash_desk_movements DROP COLUMN "loanPrincipal", DROP COLUMN "loanInterest", DROP COLUMN "loanFees"',
        );
        for (const sql of fs
          .readFileSync(migration, 'utf8')
          .split(';')
          .map((x) => x.trim())
          .filter(Boolean))
          await tx.$executeRawUnsafe(sql);
      });
    } finally {
      await proof.$disconnect();
    }
    await run(['-r', 'ts-node/register/transpile-only', 'test/loan-lifecycle.integration.ts'], env);
  } finally {
    if (owned) {
      if (!/^itemba_loan_proof_[a-f0-9]{32}$/.test(name)) throw Error('Unexpected cleanup target');
      await admin.$executeRawUnsafe('DROP DATABASE ' + name);
      console.log('Removed the disposable loan proof database.');
    }
    await admin.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
