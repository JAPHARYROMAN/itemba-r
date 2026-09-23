/* Real PostgreSQL proof in a newly created, disposable database. Never writes
 * business records to the configured application database. Run after build. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { readFileSync } = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { InvoiceDeskService } = require('../dist/modules/invoice-desk/invoice-desk.service');
const { CompanyScopeService } = require('../dist/common/services/company-scope.service');
const { OrganizationScopeService } = require('../dist/common/services/organization-scope.service');

async function main() {
  const target = new URL(process.env.DATABASE_URL);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname),
    'Only a local PostgreSQL server is permitted.',
  );
  const database = `invoice_desk_test_${randomUUID().replaceAll('-', '')}`;
  assert(/^invoice_desk_test_[a-f0-9]{32}$/.test(database));
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
      { env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe', timeout: 120000 },
    );
    db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
    const migration = readFileSync(
      path.resolve(
        __dirname,
        '../../database/prisma/migrations/20260918120000_invoice_desk/migration.sql',
      ),
      'utf8',
    );
    const checks =
      migration.match(/ALTER TABLE "invoice_desk_[^"]+" ADD CONSTRAINT "[^"]+" CHECK .*?;/g) ?? [];
    assert.equal(checks.length, 4);
    for (const check of checks) await db.$executeRawUnsafe(check);
    const group = await db.group.create({ data: { name: 'Disposable test group', code: 'TEST' } });
    const company = await db.company.create({
      data: { groupId: group.id, name: 'Disposable company', code: 'TEST' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, name: 'Test division', code: 'TEST', type: 'OTHER' },
    });
    const branch = await db.branch.create({
      data: { divisionId: division.id, name: 'Test branch', code: 'TEST', type: 'BRANCH' },
    });
    const other = await db.branch.create({
      data: { divisionId: division.id, name: 'Other branch', code: 'OTHER', type: 'BRANCH' },
    });
    const user = {
      id: randomUUID(),
      email: 'test@example.invalid',
      roles: [],
      permissions: [],
      roleScopes: ['BRANCH'],
      companyAccess: [{ companyId: company.id, accessLevel: 'WRITE' }],
      divisionAccess: [],
      branchAccess: [{ branchId: branch.id, accessLevel: 'WRITE' }],
    };
    let audits = 0;
    const service = new InvoiceDeskService(
      db,
      new CompanyScopeService(db),
      new OrganizationScopeService(db),
      {
        logStrictInTransaction: async () => {
          audits++;
        },
      },
    );
    const supplier = await service.createSupplier(user, {
      companyId: company.id,
      name: 'Test Supplier',
    });
    await assert.rejects(
      service.createSupplier(user, { companyId: company.id, name: ' test supplier ' }),
      /already exists/,
    );
    const input = {
      companyId: company.id,
      divisionId: division.id,
      branchId: branch.id,
      supplierId: supplier.id,
      invoiceNumber: 'TEST-001',
      description: 'Disposable test purchase',
      currency: 'TZS',
      invoiceDate: '2026-01-01',
      dueDate: '2026-01-31',
      totalAmount: '0.30',
    };
    const invoice = await service.create(user, input);
    await assert.rejects(
      db.invoiceDeskInvoice.update({ where: { id: invoice.id }, data: { paidAmount: '1.00' } }),
    );
    await assert.rejects(
      service.create(user, { ...input, invoiceNumber: ' test-001 ' }),
      /already exists/,
    );
    await assert.rejects(
      service.create(user, { ...input, invoiceNumber: 'TEST-002', branchId: other.id }),
      /access/,
    );
    const restricted = { ...user, branchAccess: [{ branchId: other.id, accessLevel: 'READ' }] };
    assert.equal((await service.list(restricted, { page: 1 })).total, 0);
    await assert.rejects(service.detail(restricted, invoice.id), /not found/);
    const correction = {
      version: 1,
      invoiceNumber: input.invoiceNumber,
      description: 'Corrected test purchase',
      currency: input.currency,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      totalAmount: input.totalAmount,
    };
    const edited = await service.edit(user, invoice.id, correction);
    assert.equal(edited.description, 'Corrected test purchase');
    const requests = ['0.10', '0.20'].map((amount) =>
      service.payment(user, invoice.id, {
        version: edited.version,
        requestId: randomUUID(),
        amount,
        paymentDate: '2026-01-02',
        method: 'Cash',
        reference: amount,
      }),
    );
    const outcomes = await Promise.allSettled(requests);
    assert.equal(
      outcomes.filter((r) => r.status === 'fulfilled').length,
      1,
      'Only one write may claim an invoice version.',
    );
    let detail = await service.detail(user, invoice.id);
    await assert.rejects(
      service.edit(user, invoice.id, { ...correction, version: detail.version }),
      /payment history/,
    );
    const first = detail.payments[0];
    const remaining = detail.outstanding;
    const final = {
      version: detail.version,
      requestId: randomUUID(),
      amount: remaining,
      paymentDate: '2026-01-03',
      method: 'Cash',
      reference: 'final',
    };
    await assert.rejects(
      service.payment(user, invoice.id, { ...final, amount: '1.00' }),
      /exceeds/,
    );
    assert.equal(
      (await service.detail(user, invoice.id)).version,
      detail.version,
      'Failed writes roll back version claims.',
    );
    const paid = await service.payment(user, invoice.id, final);
    await service.payment(user, invoice.id, final);
    detail = await service.detail(user, invoice.id);
    assert.equal(detail.status, 'Paid');
    assert.equal(detail.outstanding, '0.00');
    assert.equal(detail.payments.length, 2);
    await service.reverse(user, invoice.id, paid.id, {
      version: detail.version,
      reason: 'Test correction',
    });
    detail = await service.detail(user, invoice.id);
    assert.equal(detail.outstanding, remaining);
    await assert.rejects(
      service.void(user, invoice.id, { version: detail.version, reason: 'Test void' }),
      /Reverse/,
    );
    const pdf = Buffer.from('%PDF-1.4\nDisposable test attachment\n%%EOF');
    const attachment = await service.attach(user, invoice.id, {
      buffer: pdf,
      size: pdf.length,
      originalname: 'invoice.pdf',
    });
    assert((await service.attachment(user, invoice.id, attachment.id)).content.equals(pdf));
    await assert.rejects(service.attachment(restricted, invoice.id, attachment.id), /not found/);
    await assert.rejects(
      service.attach(user, invoice.id, {
        buffer: pdf,
        size: pdf.length,
        originalname: 'duplicate.pdf',
      }),
      /already exists/,
    );
    detail = await service.detail(user, invoice.id);
    await service.reverse(user, invoice.id, first.id, {
      version: detail.version,
      reason: 'Test final correction',
    });
    detail = await service.detail(user, invoice.id);
    await service.void(user, invoice.id, {
      version: detail.version,
      reason: 'Disposable invoice voided',
    });
    detail = await service.detail(user, invoice.id);
    assert.equal(detail.status, 'Void');
    assert.equal(detail.outstanding, '0.00');
    assert.equal((await service.overview(user, { page: 1 })).currencies.length, 0);
    assert(detail.events.some((e) => e.action === 'PAYMENT_REVERSED'));
    assert(audits >= 8);
    const directory = await service.directory(user);
    assert.deepEqual(
      directory.branches.map((b) => b.id),
      [branch.id],
    );
    console.log(
      'PASS: PostgreSQL invoice lifecycle, scope isolation, exact balances, concurrency, rollback, duplicate protection, attachment access and history.',
    );
  } finally {
    if (db) await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.$disconnect();
    console.log('Disposable Invoice Desk database removed.');
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
