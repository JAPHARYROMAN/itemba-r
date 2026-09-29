/* Disposable PostgreSQL proof only. Refuses all non-local/non-proof database URLs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/itemba_link_proof' ||
  process.env.ITEMBA_DISPOSABLE_PROOF !== '1'
)
  throw new Error('Use only the dedicated local itemba_link_proof database.');
require('ts-node').register({
  transpileOnly: true,
  project: path.join(__dirname, '../tsconfig.json'),
});
const { PrismaClient } = require('@prisma/client');
const { CompanyScopeService } = require('../src/common/services/company-scope.service');
const { OrganizationScopeService } = require('../src/common/services/organization-scope.service');
const { AuditLogsService } = require('../src/modules/audit-logs/audit-logs.service');
const { DeskPartyLinksService } = require('../src/common/services/desk-party-links.service');
const {
  DeskTransactionLinksService,
} = require('../src/common/services/desk-transaction-links.service');
const { InvoiceDeskService } = require('../src/modules/invoice-desk/invoice-desk.service');
const { SalesDeskService } = require('../src/modules/sales-desk/sales-desk.service');
const { BusinessReportsService } = require('../src/modules/desk-reports/business-reports.service');
const db = new PrismaClient();
async function main() {
  // Rehearse the exact additive migration over populated historical tables.
  if (await db.group.count())
    throw new Error('Proof database must start empty; never reuse a business database.');
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '../../database/prisma/migrations/20260928180000_invoice_desk_supplier_master_link/migration.sql',
    ),
    'utf8',
  );
  for (const [table, column] of [
    ['invoice_desk_suppliers', 'canonicalSupplierId'],
    ['sales_desk_customers', 'canonicalCustomerId'],
    ['invoice_desk_invoices', 'canonicalInvoiceId'],
    ['sales_desk_sales', 'canonicalSalesOrderId'],
  ]) {
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
  }
  const group = await db.group.create({
    data: { name: 'Disposable integration proof', code: 'PROOF' },
  });
  const company = await db.company.create({
    data: { groupId: group.id, code: 'PROOF', name: 'Synthetic Company' },
  });
  const division = await db.division.create({
    data: { companyId: company.id, name: 'Division', code: 'DIV', type: 'OTHER' },
  });
  const branch = await db.branch.create({
    data: { divisionId: division.id, name: 'Branch', code: 'BR', type: 'BRANCH' },
  });
  const otherBranch = await db.branch.create({
    data: { divisionId: division.id, name: 'Other branch', code: 'OTHER', type: 'BRANCH' },
  });
  const actor = await db.user.create({
    data: {
      email: 'links-proof@example.invalid',
      fullName: 'Synthetic reviewer',
      passwordHash: 'not-a-login-credential',
      companyId: company.id,
    },
  });
  const scope = { companyId: company.id, divisionId: division.id, branchId: branch.id };
  const supplier = await db.supplier.create({
    data: { companyId: company.id, supplierCode: 'SUP', name: 'Shared supplier' },
  });
  const customer = await db.customer.create({
    data: { companyId: company.id, customerCode: 'CUS', name: 'Shared customer' },
  });
  // Select only existing columns until migration has been applied.
  const oldSupplier = await db.invoiceDeskSupplier.create({
    data: { companyId: company.id, name: 'Original supplier', nameKey: 'ORIGINAL' },
    select: { id: true },
  });
  const oldCustomer = await db.salesDeskCustomer.create({
    data: { companyId: company.id, name: 'Original customer', nameKey: 'ORIGINAL' },
    select: { id: true },
  });
  const date = new Date('2026-01-01');
  const oldInvoice = await db.invoiceDeskInvoice.create({
    data: {
      ...scope,
      supplierId: oldSupplier.id,
      invoiceNumber: 'HIST-1',
      numberKey: 'HIST-1',
      description: 'Historical invoice',
      invoiceDate: date,
      dueDate: date,
      totalAmount: '100.30',
      currency: 'TZS',
    },
    select: { id: true, totalAmount: true },
  });
  const oldSale = await db.salesDeskSale.create({
    data: {
      ...scope,
      customerId: oldCustomer.id,
      requestId: 'proof-sale',
      payloadKey: 'proof',
      saleNumber: 'HIST-SALE',
      numberKey: 'HIST-SALE',
      saleDate: date,
      dueDate: date,
      totalAmount: '100.30',
      currency: 'TZS',
      createdBy: actor.id,
    },
    select: { id: true },
  });
  for (const sql of migration
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean))
    await db.$executeRawUnsafe(sql);
  assert.equal(
    (
      await db.invoiceDeskInvoice.findUniqueOrThrow({ where: { id: oldInvoice.id } })
    ).totalAmount.toFixed(2),
    '100.30',
  );
  const user = {
    id: actor.id,
    email: actor.email,
    fullName: actor.fullName,
    companyId: company.id,
    roles: [],
    roleScopes: ['COMPANY'],
    companyAccess: [{ companyId: company.id, accessLevel: 'MANAGE' }],
    permissions: [
      'invoice_desk.view',
      'invoice_desk.manage',
      'invoice_desk.payments',
      'suppliers.view',
      'suppliers.update',
      'supplier_invoices.view',
      'sales_desk.view',
      'sales_desk.manage',
      'sales.view',
      'customers.view',
      'customers.update',
      'payables.view',
    ],
  };
  const companies = new CompanyScopeService(db),
    org = new OrganizationScopeService(db),
    audit = new AuditLogsService(db);
  const parties = new DeskPartyLinksService(db, companies, org, audit),
    links = new DeskTransactionLinksService(db, companies, org, audit);
  const invoices = new InvoiceDeskService(db, companies, org, audit, parties);
  const sales = new SalesDeskService(db, companies, org, audit, {}, parties);
  const reports = new BusinessReportsService(db, companies, org);
  await parties.link(user, 'supplier', oldSupplier.id, supplier.id);
  await parties.link(user, 'customer', oldCustomer.id, customer.id);
  assert.equal((await parties.choices(user, 'supplier', {}))[0].canonicalId, supplier.id);
  assert.equal(
    (await invoices.supplierInvoices(user, supplier.id, { page: 1 })).rows[0].id,
    oldInvoice.id,
  );
  assert.equal((await sales.customerSales(user, customer.id, { page: 1 })).rows[0].id, oldSale.id);
  const alias = await db.invoiceDeskSupplier.create({
    data: { companyId: company.id, name: 'Second historical alias', nameKey: 'ALIAS' },
  });
  await parties.link(user, 'supplier', alias.id, supplier.id);
  await db.invoiceDeskInvoice.create({
    data: {
      ...scope,
      supplierId: alias.id,
      invoiceNumber: 'ADDITIONAL',
      numberKey: 'ADDITIONAL',
      description: 'Separate historical purchase',
      invoiceDate: date,
      dueDate: date,
      totalAmount: '0.70',
      currency: 'TZS',
    },
  });
  assert.equal((await invoices.list(user, { page: 1, supplierId: oldSupplier.id })).total, 2);
  assert.equal((await invoices.overview(user, { page: 1 })).suppliers.length, 1);
  const payable = await db.payable.create({
    data: {
      ...scope,
      payableNumber: 'PAY-PROOF',
      supplierId: supplier.id,
      supplierName: supplier.name,
      amount: '100.30',
      outstandingAmount: '100.30',
      issueDate: date,
    },
  });
  const businessInvoice = await db.supplierInvoice.create({
    data: {
      ...scope,
      supplierId: supplier.id,
      supplierInvoiceNumber: 'BUS-1',
      totalAmount: '100.30',
      outstandingAmount: '100.30',
      status: 'APPROVED',
      createdById: actor.id,
      payableId: payable.id,
    },
  });
  const businessSale = await db.salesOrder.create({
    data: {
      ...scope,
      customerId: customer.id,
      customerName: customer.name,
      salesOrderNumber: 'BUS-SALE',
      orderDate: date,
      createdById: actor.id,
      totalAmount: '100.30',
      outstandingAmount: '100.30',
      status: 'CONFIRMED',
    },
  });
  const retries = await Promise.all([
    links.link(user, 'invoice', oldInvoice.id, businessInvoice.id),
    links.link(user, 'invoice', oldInvoice.id, businessInvoice.id),
  ]);
  assert.equal(retries[0].canonicalId, retries[1].canonicalId);
  await links.link(user, 'sale', oldSale.id, businessSale.id);
  assert.equal((await invoices.list(user, { page: 1 })).total, 1);
  assert.equal((await sales.list(user, { page: 1 })).total, 0);
  assert.equal(
    (await reports.read(user, { kind: 'suppliers' })).totals[0].balance.toFixed(2),
    '100.30',
  );
  assert.equal((await reports.read(user, { kind: 'sales' })).totals[0].amount.toFixed(2), '100.30');
  assert.equal(await db.journalEntry.count(), 0);
  assert.equal(await db.cashDeskMovement.count(), 0);
  await assert.rejects(
    () =>
      invoices.payment(user, oldInvoice.id, {
        requestId: 'blocked',
        version: 2,
        amount: '1',
        paymentDate: '2026-01-02',
        method: 'Cash',
        reference: 'proof',
      }),
    /linked business/,
  );
  const restricted = {
    ...user,
    roleScopes: ['BRANCH'],
    divisionAccess: [],
    branchAccess: [{ branchId: otherBranch.id, accessLevel: 'WRITE' }],
  };
  assert.equal((await invoices.supplierInvoices(restricted, supplier.id, { page: 1 })).total, 0);
  await assert.rejects(
    () => links.link(restricted, 'sale', oldSale.id, businessSale.id),
    /not found/,
  );
  // Compete a real payment with a link. Exactly one financial interpretation may win.
  const race = await db.invoiceDeskInvoice.create({
    data: {
      ...scope,
      supplierId: oldSupplier.id,
      invoiceNumber: 'RACE',
      numberKey: 'RACE',
      description: 'Race proof',
      invoiceDate: date,
      dueDate: date,
      totalAmount: '25.00',
      currency: 'TZS',
    },
  });
  const racePayable = await db.payable.create({
    data: {
      ...scope,
      payableNumber: 'PAY-RACE',
      supplierId: supplier.id,
      supplierName: supplier.name,
      amount: '25',
      outstandingAmount: '25',
      issueDate: date,
    },
  });
  const target = await db.supplierInvoice.create({
    data: {
      ...scope,
      supplierId: supplier.id,
      supplierInvoiceNumber: 'BUS-RACE',
      totalAmount: '25',
      outstandingAmount: '25',
      status: 'APPROVED',
      createdById: actor.id,
      payableId: racePayable.id,
    },
  });
  const outcomes = await Promise.allSettled([
    links.link(user, 'invoice', race.id, target.id),
    invoices.payment(user, race.id, {
      requestId: 'race-payment',
      version: race.version,
      amount: '0.30',
      paymentDate: '2026-01-02',
      method: 'Cash',
      reference: 'proof',
    }),
  ]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  const after = await db.invoiceDeskInvoice.findUniqueOrThrow({
    where: { id: race.id },
    include: { payments: true },
  });
  assert.ok(
    after.canonicalInvoiceId
      ? after.paidAmount.isZero() && after.payments.length === 0
      : after.paidAmount.eq('0.30') && after.payments.length === 1,
  );
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        'populated migration preserves IDs and amounts',
        'shared directory and history',
        'duplicate link retry',
        'canonical reporting without double count',
        'linked entries reject second payment',
        'branch isolation',
        'concurrent link versus payment',
      ],
      productionTouched: false,
    }),
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
