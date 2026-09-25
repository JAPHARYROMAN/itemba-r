/* Real persistence/concurrency proof in a disposable local database. Never writes business data. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { RecordsService } = require('../dist/modules/records/records.service');
const { CompanyScopeService } = require('../dist/common/services/company-scope.service');
const { OrganizationScopeService } = require('../dist/common/services/organization-scope.service');
async function main() {
  const target = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(target.hostname));
  const database = `records_test_${randomUUID().replaceAll('-', '')}`;
  assert(/^records_test_[a-f0-9]{32}$/.test(database));
  const admin = new PrismaClient();
  let db,
    created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    target.pathname = '/' + database;
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--schema',
        path.resolve(__dirname, '../../database/prisma/schema.prisma'),
        '--skip-generate',
      ],
      { env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe', timeout: 180000 },
    );
    db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
    const migration = readFileSync(
      path.resolve(
        __dirname,
        '../../database/prisma/migrations/20260925110000_records/migration.sql',
      ),
      'utf8',
    );
    for (const check of migration.match(
      /ALTER TABLE "record_[^"]+" ADD CONSTRAINT "[^"]+" CHECK[\s\S]*?;/g,
    ) ?? [])
      await db.$executeRawUnsafe(check);
    const statementMigration = readFileSync(
      path.resolve(
        __dirname,
        '../../database/prisma/migrations/20260925160000_record_statements/migration.sql',
      ),
      'utf8',
    );
    for (const check of statementMigration.match(
      /ALTER TABLE "record_[^"]+" ADD CONSTRAINT "[^"]+" CHECK[\s\S]*?;/g,
    ) ?? [])
      await db.$executeRawUnsafe(check);
    const group = await db.group.create({
      data: { name: 'Disposable Records group', code: 'TEST' },
    });
    async function org(code) {
      const c = await db.company.create({ data: { groupId: group.id, name: code, code } });
      const d = await db.division.create({
        data: { companyId: c.id, name: code, code, type: 'OTHER' },
      });
      const b = await db.branch.create({
        data: { divisionId: d.id, name: code, code, type: 'BRANCH' },
      });
      return { companyId: c.id, divisionId: d.id, branchId: b.id };
    }
    const a = await org('A'),
      b = await org('B');
    const owner = await db.user.create({
      data: {
        email: 'records@example.invalid',
        fullName: 'Records proof',
        passwordHash: 'no-login',
      },
    });
    const other = await db.user.create({
      data: { email: 'other@example.invalid', fullName: 'Other proof', passwordHash: 'no-login' },
    });
    const user = {
      id: owner.id,
      email: owner.email,
      roles: [],
      roleScopes: ['GROUP'],
      permissions: ['records.view', 'records.manage', 'records.export'],
      companyAccess: [a, b].map((s) => ({ companyId: s.companyId, accessLevel: 'WRITE' })),
      divisionAccess: [],
      branchAccess: [],
    };
    const branchUser = {
      ...user,
      id: other.id,
      email: other.email,
      roleScopes: ['BRANCH'],
      companyAccess: [{ companyId: a.companyId, accessLevel: 'WRITE' }],
      branchAccess: [{ branchId: a.branchId, accessLevel: 'WRITE' }],
    };
    let failAudit = false;
    const audit = {
      logStrictInTransaction: async () => {
        if (failAudit) throw new Error('Audit unavailable');
      },
    };
    const service = new RecordsService(
      db,
      new CompanyScopeService(db),
      new OrganizationScopeService(db),
      audit,
      {
        renderLetterheadPdf: async (source, model) => {
          assert.equal(model.title, 'Creditor statement');
          return Buffer.from('%PDF-test');
        },
      },
    );
    const draft = (extra = {}) => ({
      requestId: randomUUID(),
      kind: 'DEBTOR',
      title: 'Temporary record',
      counterparty: 'Person',
      currency: 'TZS',
      amount: '100.30',
      recordDate: '2026-01-02',
      dueDate: '2026-01-03',
      ...extra,
    });
    const payload = draft();
    const personal = await service.create(user, payload);
    assert.equal((await service.create(user, payload)).id, personal.id);
    await assert.rejects(service.create(user, { ...payload, amount: '20' }), /reference/);
    await assert.rejects(service.detail(branchUser, personal.id), /not found/);
    const linked = await service.create(user, draft(a));
    const foreign = await service.create(user, draft(b));
    assert.equal((await service.detail(branchUser, linked.id)).id, linked.id);
    await assert.rejects(service.detail(branchUser, foreign.id), /not found/);
    assert.equal((await service.list(branchUser, { page: 1 })).total, 1);
    assert.equal((await service.export(branchUser, { page: 1 })).count, 1);
    await assert.rejects(
      service.create(user, draft({ ...a, branchId: b.branchId })),
      /same organisation/,
    );
    await assert.rejects(service.create(branchUser, draft({ companyId: a.companyId })), /scope/);
    const readOnly = {
      ...branchUser,
      companyAccess: [{ companyId: a.companyId, accessLevel: 'READ' }],
    };
    await assert.rejects(
      service.settle(readOnly, linked.id, {
        requestId: randomUUID(),
        version: 1,
        amount: '10',
        date: '2026-01-04',
      }),
      /access/,
    );
    const settlement = {
      requestId: randomUUID(),
      version: 1,
      amount: '0.10',
      date: '2026-01-04',
      reference: 'Proof',
    };
    assert.equal((await service.settle(user, personal.id, settlement)).balance, '100.20');
    assert.equal((await service.settle(user, personal.id, settlement)).balance, '100.20');
    assert.equal(await db.recordSettlement.count({ where: { recordId: personal.id } }), 1);
    assert.equal(await db.recordPosting.count({ where: { recordId: personal.id } }), 2);
    const firstStatement = await service.statement(user, personal.id, { to: '2026-01-04' });
    assert.equal(firstStatement.closingBalance, '100.20');
    assert.equal(firstStatement.rows[0].debit, '100.30');
    assert.equal(firstStatement.rows[1].credit, '0.10');
    await assert.rejects(service.statement(branchUser, personal.id, {}), /not found/);
    await assert.rejects(
      service.exportStatement(branchUser, foreign.id, { format: 'csv' }),
      /not found/,
    );
    await assert.rejects(
      service.statement(user, personal.id, { from: '2026-01-05', to: '2026-01-04' }),
      /Start date/,
    );
    await assert.rejects(
      service.settle(user, personal.id, { ...settlement, amount: '0.20' }),
      /already used/,
    );
    await assert.rejects(
      service.settle(user, personal.id, {
        ...settlement,
        requestId: randomUUID(),
        version: 2,
        amount: '101',
      }),
      /outstanding/,
    );
    const concurrent = await Promise.allSettled(
      [1, 2].map(() =>
        service.settle(user, personal.id, {
          requestId: randomUUID(),
          version: 2,
          amount: '70.10',
          date: '2026-01-04',
        }),
      ),
    );
    assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
    let current = await service.detail(user, personal.id);
    assert.equal(current.balance, '30.10');
    for (const s of current.settlements) {
      current = await service.reverse(user, personal.id, s.id, {
        version: current.version,
        reason: 'Test correction',
      });
    }
    assert.equal(current.balance, '100.30');
    assert.equal(
      (await service.statement(user, personal.id, { to: '2026-01-04' })).closingBalance,
      '30.10',
    );
    assert.equal((await service.statement(user, personal.id, {})).closingBalance, current.balance);
    const revised = { ...payload, amount: '150.50', version: current.version };
    delete revised.requestId;
    current = await service.update(user, personal.id, revised);
    assert.equal(current.balance, '150.50');
    const adjustedStatement = await service.statement(user, personal.id, {});
    assert.equal(adjustedStatement.closingBalance, current.balance);
    assert.equal(adjustedStatement.rows.at(-1).kind, 'ADJUSTMENT');
    assert.equal(adjustedStatement.rows.at(-1).debit, '50.20');
    await assert.rejects(
      service.update(user, personal.id, {
        ...revised,
        version: current.version,
        recordDate: '2026-01-01',
      }),
      /dates are fixed/,
    );
    await assert.rejects(
      service.settle(user, personal.id, {
        requestId: randomUUID(),
        version: current.version,
        amount: '1',
        date: '2026-01-05',
      }),
      /latest statement/,
    );
    await assert.rejects(service.update(user, personal.id, revised), /changed/);
    const badMove = { ...revised, ...a, version: current.version };
    await assert.rejects(service.update(user, personal.id, badMove), /cannot be changed/);
    const note = await service.create(
      user,
      draft({ kind: 'NOTE', amount: '0', dueDate: null, title: '=formula', notes: 'Useful note' }),
    );
    assert.equal(note.balance, '0.00');
    const expense = await service.create(
      user,
      draft({ kind: 'EXPENSE', dueDate: null, currency: 'USD', amount: '20.45' }),
    );
    await assert.rejects(
      service.settle(user, expense.id, { ...settlement, requestId: randomUUID() }),
      /Only active/,
    );
    assert((await service.export(user, { page: 1 })).csv.includes('"\'=formula"'));
    const totals = await service.summary(user, { page: 1 });
    assert.equal(totals.find((r) => r.kind === 'EXPENSE').currency, 'USD');
    failAudit = true;
    await assert.rejects(
      service.create(user, draft({ title: 'Must rollback' })),
      /Audit unavailable/,
    );
    failAudit = false;
    assert.equal(await db.recordEntry.count({ where: { title: 'Must rollback' } }), 0);
    current = await service.void(user, personal.id, {
      version: current.version,
      reason: 'Proof completed',
    });
    assert.equal(current.status, 'void');
    assert.equal((await service.statement(user, personal.id, {})).closingBalance, '0.00');
    const creditor = await service.create(
      user,
      draft({ kind: 'CREDITOR', title: 'Supplier account' }),
    );
    let paid = await service.settle(user, creditor.id, {
      requestId: randomUUID(),
      version: 1,
      amount: '30.10',
      date: '2026-01-05',
    });
    assert.equal(paid.balance, '70.20');
    const creditorStatement = await service.statement(user, creditor.id, {
      from: '2026-01-04',
      to: '2026-01-05',
    });
    assert.equal(creditorStatement.openingBalance, '100.30');
    assert.equal(creditorStatement.totalDebit, '30.10');
    assert.equal(creditorStatement.totalCredit, '0.00');
    const exported = await service.exportStatement(user, creditor.id, { format: 'csv' });
    assert(exported.buffer.toString().includes('"70.20","Cr"'));
    assert.equal(
      (await service.exportStatement(user, creditor.id, { format: 'pdf' })).mimeType,
      'application/pdf',
    );
    failAudit = true;
    await assert.rejects(
      service.settle(user, creditor.id, {
        requestId: randomUUID(),
        version: 2,
        amount: '20',
        date: '2026-01-06',
      }),
      /Audit unavailable/,
    );
    failAudit = false;
    assert.equal((await service.statement(user, creditor.id, {})).closingBalance, '70.20');
    assert.equal(await db.recordPosting.count({ where: { recordId: creditor.id } }), 2);
    paid = await service.settle(user, creditor.id, {
      requestId: randomUUID(),
      version: 2,
      amount: '70.20',
      date: '2026-01-06',
    });
    assert.equal(paid.status, 'settled');
    assert.equal((await service.statement(user, creditor.id, {})).closingBalance, '0.00');
    assert.equal((await service.list(user, { page: 1, status: 'void' })).total, 1);
    for (const table of ['salesDeskSale', 'invoiceDeskInvoice', 'cashDeskMovement', 'journalEntry'])
      assert.equal(await db[table].count(), 0);
    // Rehearse the legacy cutover on this disposable database only. The original
    // mutable records become an explicit snapshot; no invented payment history.
    await db.recordPosting.deleteMany();
    for (const sql of statementMigration
      .slice(statementMigration.indexOf('UPDATE "record_entries"'))
      .split(';')
      .filter((s) => s.trim()))
      await db.$executeRawUnsafe(sql);
    assert.equal((await service.statement(user, linked.id, {})).closingBalance, '100.30');
    assert.equal((await service.statement(user, creditor.id, {})).closingBalance, '0.00');
    assert.equal((await service.statement(user, personal.id, {})).closingBalance, '0.00');
    assert((await service.statement(user, linked.id, {})).startsOn);
    await assert.rejects(
      service.statement(user, linked.id, { to: '2026-01-05' }),
      /history begins/,
    );
    console.log(
      'PASS: privacy and scoped statement/export access; exact debtor/creditor partial and full payments; dated opening/closing balances; historical reversals; amount corrections; idempotent retries; concurrent settlements; atomic statement/audit rollback; CSV/PDF contracts; legacy snapshot migration; zero ERP writes.',
    );
  } finally {
    if (db) await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.$disconnect();
    console.log('Disposable Records database removed.');
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
