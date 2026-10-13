/* This proof only writes to a newly created, local disposable database. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
process.env.NODE_ENV = 'test';
process.env.MSAIDIZI_CHAT_DISPOSABLE_DB = '1';
process.env.JOB_WORKER_ENABLED = 'false';
require('../test/setup-env.js');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');

async function main() {
  assert(
    process.env.CUSTOMER_PERFORMANCE_TEST_DATABASE_URL,
    'An explicit local proof connection is required',
  );
  const target = new URL(process.env.CUSTOMER_PERFORMANCE_TEST_DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(target.hostname), 'Only local PostgreSQL is allowed');
  const database = `customer_account_evidence_${randomUUID().replaceAll('-', '')}`;
  assert(/^customer_account_evidence_[a-f0-9]{32}$/.test(database));
  const admin = new PrismaClient({ datasources: { db: { url: target.toString() } } });
  let app,
    db,
    created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    target.pathname = '/' + database;
    process.env.DATABASE_URL = target.toString();
    const schema = path.resolve(__dirname, '../../database/prisma/schema.prisma');
    const prismaCli = require.resolve('prisma/build/index.js');
    execFileSync(
      process.execPath,
      [prismaCli, 'db', 'push', '--schema', schema, '--skip-generate'],
      {
        env: process.env,
        stdio: 'pipe',
        timeout: 120000,
      },
    );
    db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
    await db.$executeRawUnsafe(
      'ALTER TABLE "customer_statement_runs" DROP COLUMN "snapshot", DROP COLUMN "snapshotHash", DROP COLUMN "pdfContent", DROP COLUMN "calculationVersion"',
    );
    execFileSync(
      process.execPath,
      [
        prismaCli,
        'db',
        'execute',
        '--schema',
        schema,
        '--file',
        path.resolve(
          __dirname,
          '../../database/prisma/migrations/20261013120000_customer_statement_snapshots/migration.sql',
        ),
      ],
      {
        env: process.env,
        stdio: 'pipe',
        timeout: 120000,
      },
    );
    const { createE2eApp } = require('../test/e2e-app');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const {
      CustomerStatementsService,
    } = require('../src/modules/customer-statements/customer-statements.service');
    const {
      seedCrudCustomerAccountReadControls,
    } = require('../test/crud-customer-account-read-controls');
    const request = require('supertest');
    const argon2 = require('argon2');
    app = await createE2eApp({ useProductionPipeline: true, logLevels: ['error'] });
    const prisma = app.get(PrismaService);
    const permissions = [
      'customers.view',
      'sales.view',
      'receivables.view',
      'customer-payments.view',
      'cash_desk.view',
      'customer_statements.view',
      'customer_statements.generate',
    ];
    const permissionRows = await Promise.all(
      permissions.map((code) =>
        prisma.permission.create({
          data: {
            code,
            module: code.split('.')[0],
            action: code.split('.')[1],
            description: 'Isolated account read proof',
          },
        }),
      ),
    );
    const roles = await Promise.all(
      ['GROUP', 'COMPANY'].map((scope) =>
        prisma.role.create({
          data: {
            name: `ACCOUNT_EVIDENCE_${scope}`,
            displayName: `Account evidence ${scope}`,
            scope,
            rolePermissions: {
              create: permissionRows.map((permission) => ({ permissionId: permission.id })),
            },
          },
        }),
      ),
    );
    const group = await prisma.group.create({
      data: { code: 'ACCOUNT-EVIDENCE', name: 'Account evidence' },
    });
    const companies = await Promise.all(
      ['A', 'B'].map((side) =>
        prisma.company.create({
          data: {
            groupId: group.id,
            code: `ACCOUNT-${side}`,
            name: `Account evidence ${side}`,
          },
        }),
      ),
    );
    const divisions = await Promise.all(
      companies.map((company, i) =>
        prisma.division.create({
          data: {
            companyId: company.id,
            code: `ACCOUNT-DIV-${i}`,
            name: 'Trading',
            type: 'OTHER',
          },
        }),
      ),
    );
    const branches = await Promise.all(
      divisions.map((division, i) =>
        prisma.branch.create({
          data: {
            divisionId: division.id,
            code: `ACCOUNT-BR-${i}`,
            name: 'Trading',
            type: 'BRANCH',
          },
        }),
      ),
    );
    const password = 'AccountEvidencePass123!';
    const passwordHash = await argon2.hash(password);
    const users = await Promise.all(
      roles.map((role, i) =>
        prisma.user.create({
          data: {
            email: `account-${i}@example.invalid`,
            fullName: `Account evidence ${i}`,
            passwordHash,
            companyId: companies[0].id,
            userRoles: { create: { roleId: role.id } },
            companyAccess: {
              create: (i === 0 ? companies : [companies[0]]).map((company) => ({
                companyId: company.id,
                accessLevel: 'MANAGE',
              })),
            },
          },
        }),
      ),
    );
    const issuer = {
      id: users[0].id,
      email: users[0].email,
      roles: [roles[0].name],
      roleScopes: ['GROUP'],
      permissions,
      companyId: companies[0].id,
      companyAccess: companies.map((company) => ({ companyId: company.id, accessLevel: 'MANAGE' })),
    };
    const seed = await seedCrudCustomerAccountReadControls(
      prisma,
      app.get(CustomerStatementsService),
      {
        companyAId: companies[0].id,
        companyBId: companies[1].id,
        divisionAId: divisions[0].id,
        divisionBId: divisions[1].id,
        branchAId: branches[0].id,
        branchBId: branches[1].id,
        suffix: database.slice(-8),
      },
      issuer,
    );
    const tokens = await Promise.all(
      users.map(async (user) => {
        const login = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: user.email, password });
        assert.equal(login.status, 200);
        const body = login.body.data ?? login.body;
        assert(body.accessToken);
        return body.accessToken;
      }),
    );
    const tables = await prisma.$queryRawUnsafe(
      'SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = current_schema() ORDER BY tablename',
    );
    async function census() {
      const rows = [];
      for (const { tablename } of tables) {
        assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename));
        const digest = await prisma.$queryRawUnsafe(
          `SELECT count(*)::text AS count, md5(COALESCE(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text), '')) AS hash FROM "${tablename}" t`,
        );
        rows.push([tablename, digest[0].count, digest[0].hash]);
      }
      return rows;
    }
    const selection = {
      companyId: companies[0].id,
      currency: 'TZS',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    };
    async function read(route, query, token, expectedStatus) {
      const before = await census();
      const response = await request(app.getHttpServer())
        .get('/api/v1/' + route)
        .query(query)
        .set('Authorization', 'Bearer ' + token);
      assert.equal(response.status, expectedStatus, JSON.stringify(response.body));
      assert.deepEqual(await census(), before, `GET ${route} changed persisted database contents`);
      return response.body.data ?? response.body;
    }
    const directory = await read('customer-performance', selection, tokens[0], 200);
    assert(directory.rows.some((row) => row.id === seed.customerA));
    assert(!JSON.stringify(directory).includes(seed.customerB));
    const history = await read(
      `customer-performance/${seed.customerA}/history`,
      selection,
      tokens[1],
      200,
    );
    assert.equal(history.customer.id, seed.customerA);
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0].id, seed.paymentA);
    assert.equal(history.rows[0].amount, '125.00');
    assert.equal(history.rows[0].allocations[0].amount, '125.00');
    assert(!JSON.stringify(history).includes(seed.paymentB));
    const authorizedHistoryB = await read(
      `customer-performance/${seed.customerB}/history`,
      { ...selection, companyId: companies[1].id },
      tokens[0],
      200,
    );
    assert.equal(authorizedHistoryB.customer.id, seed.customerB);
    assert.equal(authorizedHistoryB.rows[0].id, seed.paymentB);
    await read(`customer-performance/${seed.customerB}/history`, selection, tokens[1], 404);
    const issued = await read(`customer-statements/${seed.statementA}/detail`, {}, tokens[1], 200);
    assert.equal(issued.runId, seed.statementA);
    assert.equal(issued.customerId, seed.customerA);
    assert.equal(issued.closingBalance, '875.00');
    const authorizedIssuedB = await read(
      `customer-statements/${seed.statementB}/detail`,
      {},
      tokens[0],
      200,
    );
    assert.equal(authorizedIssuedB.runId, seed.statementB);
    assert.equal(authorizedIssuedB.customerId, seed.customerB);
    await read(`customer-statements/${seed.statementB}/detail`, {}, tokens[1], 403);
    console.log(
      'PASS account read evidence: real A/B sources, posted receipt allocation, service-issued JSON/PDF/audit, foreign-company denials and all-table GET mutation census',
    );
  } finally {
    if (app) await app.close();
    if (db) await db.$disconnect();
    if (created) {
      await admin.$executeRawUnsafe(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        database,
      );
      await admin.$executeRawUnsafe(`DROP DATABASE "${database}"`);
    }
    await admin.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
