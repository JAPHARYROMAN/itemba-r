/* Runs only inside the already guarded, isolated POS proof with its synthetic company. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AuditLogsService } = require('../dist/modules/audit-logs/audit-logs.service');
const { CompanyScopeService } = require('../dist/common/services/company-scope.service');
const { OrganizationScopeService } = require('../dist/common/services/organization-scope.service');
const { AccountingControlService } = require('../dist/common/services/accounting-control.service');
const { AccountResolverService } = require('../dist/common/services/account-resolver.service');
const {
  PostingEngineService,
} = require('../dist/modules/accounting-engine/posting-engine.service');
const {
  EntityCodeGeneratorService,
} = require('../dist/modules/entity-code-generator/entity-code-generator.service');
const { CashBookService } = require('../dist/modules/cash-book/cash-book.service');
const {
  SupplierPaymentsService,
} = require('../dist/modules/supplier-payments/supplier-payments.service');
const { InvoiceDeskService } = require('../dist/modules/invoice-desk/invoice-desk.service');
const { CashPurchasesService } = require('../dist/modules/cash-desk/cash-purchases.service');
const { CashDeskService } = require('../dist/modules/cash-desk/cash-desk.service');
const num = (value) => Number(value);

async function verifyCashPurchases({ db, check, fixture: f, call }) {
  assert.ok(f.company.code.startsWith('POS-'), 'Purchase proof requires owned synthetic fixture');
  const date = new Date().toISOString().slice(0, 10);
  const scope = { companyId: f.company.id, divisionId: f.division.id, branchId: f.branch.id };
  const user = {
    id: f.admin.user.id,
    email: f.admin.user.email,
    fullName: 'Proof purchase officer',
    companyId: f.company.id,
    roles: [],
    roleScopes: ['COMPANY'],
    companyAccess: [{ companyId: f.company.id, accessLevel: 'MANAGE' }],
    divisionAccess: [],
    branchAccess: [],
    permissions: [
      'payables.view',
      'supplier-payments.view',
      'supplier-payments.manage',
      'invoice_desk.view',
      'invoice_desk.payments',
      'mobile_pos_lite.manage',
    ],
  };
  const invoice = await db.supplierInvoice.findFirst({
    where: {
      ...scope,
      status: 'APPROVED',
      payableId: { not: null },
      deletedAt: null,
      purchaseOrder: { status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] }, deletedAt: null },
    },
    include: { payable: true, purchaseOrder: true },
  });
  assert.ok(
    invoice?.payable && invoice.purchaseOrder,
    'Full receipt/invoice workflow must supply an existing purchase',
  );
  const payable = invoice.payable;
  const audit = new AuditLogsService(db),
    companies = new CompanyScopeService(db),
    org = new OrganizationScopeService(db);
  const resolver = new AccountResolverService(db),
    control = new AccountingControlService(db),
    engine = new PostingEngineService(db, control, resolver);
  const codes = new EntityCodeGeneratorService(db);
  const period = await db.accountingPeriod.findFirstOrThrow({
    where: { companyId: f.company.id, status: 'OPEN' },
  });
  const stock = async () =>
    (
      await db.inventoryBalance.findMany({
        where: { companyId: f.company.id },
        orderBy: { id: 'asc' },
        select: { id: true, quantityOnHand: true, averageCost: true, totalValue: true },
      })
    ).map((r) => JSON.stringify(r));

  for (const enabled of [false, true]) {
    const suffix = `${enabled ? 'ON' : 'OFF'}-${randomUUID().slice(0, 8)}`;
    const ledger = await db.chartOfAccount.create({
      data: {
        companyId: f.company.id,
        accountCode: 'PURCHASE-' + suffix,
        accountName: 'Purchase proof cash ' + suffix,
        accountType: 'ASSET',
      },
    });
    const cash = await db.cashAccount.create({
      data: {
        ...scope,
        accountName: 'Purchase proof ' + suffix,
        accountType: 'CASH_ON_HAND',
        currency: 'TZS',
        ledgerAccountId: ledger.id,
        openingBalance: 500,
        currentBalance: 500,
      },
    });
    const desk = await db.cashDeskAccount.create({
      data: {
        ...scope,
        name: 'Purchase desk ' + suffix,
        nameKey: suffix,
        erpCashAccountId: cash.id,
        kind: 'CASH',
        currency: 'TZS',
        openingDate: new Date('2026-01-01'),
        balance: 500,
      },
    });
    const opening = await db.cashDeskMovement.create({
      data: {
        requestId: randomUUID(),
        payloadKey: suffix,
        kind: 'OPENING',
        amount: 500,
        currency: 'TZS',
        businessDate: new Date('2026-01-01'),
        description: 'Synthetic proof opening',
        reference: suffix,
        createdBy: user.id,
        actorName: user.fullName,
      },
    });
    await db.cashDeskEntry.create({
      data: {
        movementId: opening.id,
        accountId: desk.id,
        businessDate: opening.businessDate,
        amount: 500,
      },
    });
    const book = new CashBookService(db, audit, companies, { get: () => String(enabled) });
    const payments = new SupplierPaymentsService(
      db,
      audit,
      companies,
      resolver,
      engine,
      codes,
      book,
    );
    const invoices = new InvoiceDeskService(db, companies, org, audit, undefined, payments);
    const purchases = new CashPurchasesService(db, companies, org, payments);
    const service = new CashDeskService(
      db,
      companies,
      org,
      audit,
      invoices,
      undefined,
      undefined,
      undefined,
      purchases,
    );
    const input = {
      requestId: randomUUID(),
      kind: 'SUPPLIER_PAYMENT',
      accountId: desk.id,
      payableId: payable.id,
      supplierId: f.supplier.id,
      amount: '25.00',
      businessDate: date,
      description: 'Pay existing purchase ' + suffix,
      reference: invoice.supplierInvoiceNumber,
    };
    const snapshot = async () => {
      const [p, si, po, erp, drawer, supplier] = await Promise.all([
        db.payable.findUniqueOrThrow({ where: { id: payable.id } }),
        db.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
        db.purchaseOrder.findUniqueOrThrow({ where: { id: invoice.purchaseOrderId } }),
        db.cashAccount.findUniqueOrThrow({ where: { id: cash.id } }),
        db.cashDeskAccount.findUniqueOrThrow({ where: { id: desk.id } }),
        db.supplier.findUniqueOrThrow({ where: { id: f.supplier.id } }),
      ]);
      return {
        paid: num(p.paidAmount),
        outstanding: num(p.outstandingAmount),
        invoicePaid: num(si.paidAmount),
        invoiceOutstanding: num(si.outstandingAmount),
        orderPaid: num(po.paidAmount),
        orderOutstanding: num(po.outstandingAmount),
        orderStatus: po.paymentStatus,
        cash: num(erp.currentBalance),
        desk: num(drawer.balance),
        version: drawer.version,
        supplier: num(supplier.currentBalance),
        journals: await db.journalEntry.count({ where: { companyId: f.company.id } }),
        payments: await db.supplierPayment.count({ where: { companyId: f.company.id } }),
        entries: await db.cashDeskEntry.count({ where: { accountId: desk.id } }),
      };
    };
    let movement;
    const before = await snapshot(),
      beforeStock = await stock();
    await check(
      `Purchases post one canonical payment, linked AP/cash/desk/journal with cash-book flag ${enabled ? 'on' : 'off'}`,
      async () => {
        const options = await call(
          f.admin.token,
          'GET',
          `/cash-desk/purchase-options?accountId=${desk.id}&supplierId=${f.supplier.id}&source=PAYABLE&id=${payable.id}`,
        );
        assert.equal(options.rows[0]?.id, payable.id);
        assert.equal(options.rows[0].canPay, true);
        const results = await Promise.all([
          service.record(user, input),
          service.record(user, { ...input }),
        ]);
        movement = results[0];
        assert.equal(results[1].id, movement.id);
        const after = await snapshot();
        assert.equal(after.paid, before.paid + 25);
        assert.equal(after.outstanding, before.outstanding - 25);
        assert.equal(after.invoicePaid, before.invoicePaid + 25);
        assert.equal(after.orderPaid, before.orderPaid + 25);
        assert.equal(after.orderOutstanding, before.orderOutstanding - 25);
        assert.equal(after.orderStatus, 'PARTIALLY_PAID');
        assert.equal(after.cash, 475);
        assert.equal(after.desk, 475);
        assert.equal(after.payments, before.payments + 1);
        assert.equal(after.journals, before.journals + 1);
        assert.equal(after.entries, before.entries + 1);
        assert.equal(after.supplier, before.supplier - 25);
        assert.deepEqual(await stock(), beforeStock);
        const linked = await service.movement(user, movement.id);
        assert.equal(linked.payable.id, payable.id);
        assert.equal(linked.payable.supplierInvoices[0].id, invoice.id);
        assert.equal(linked.payable.purchaseOrders[0].id, invoice.purchaseOrderId);
        assert.ok(linked.journalEntry.journalNumber);
        assert.equal(linked.supplierPayment.sourceType, 'CashDesk');
        assert.equal(linked.supplierPayment.sourceId, movement.id);
        const journal = await db.journalEntry.findUniqueOrThrow({
          where: { id: movement.journalEntryId },
          include: { lines: true },
        });
        assert.equal(num(journal.totalDebit), 25);
        assert.equal(num(journal.totalCredit), 25);
        assert.equal(journal.lines.find((line) => num(line.credit) === 25).accountId, ledger.id);
        const stable = await snapshot();
        await assert.rejects(service.record(user, { ...input, amount: '26.00' }));
        await assert.rejects(service.record({ ...user, id: f.reviewer.user.id }, input));
        await assert.rejects(
          payments.reverse(movement.supplierPaymentId, { reason: 'Wrong source app' }, user),
        );
        assert.deepEqual(await snapshot(), stable);
      },
    );
    await check(
      `Purchases reject invalid inputs and roll back closed-period/audit failures with cash-book flag ${enabled ? 'on' : 'off'}`,
      async () => {
        const stable = await snapshot();
        for (const change of [
          { amount: '999.00' },
          { amount: String(stable.outstanding + 1) },
          { supplierId: randomUUID() },
          { businessDate: '2025-12-31' },
        ])
          await assert.rejects(
            service.record(user, { ...input, ...change, requestId: randomUUID() }),
          );
        const collision = await db.supplierPayment.findFirstOrThrow({
          where: { id: movement.supplierPaymentId },
        });
        await assert.rejects(
          service.record(user, {
            ...input,
            requestId: collision.requestId,
            description: 'Changed payload',
          }),
        );
        await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'CLOSED' } });
        try {
          await assert.rejects(service.record(user, { ...input, requestId: randomUUID() }));
        } finally {
          await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
        }
        const failingAudit = {
          logStrictInTransaction: async () => {
            throw new Error('Synthetic strict audit failure');
          },
        };
        const failed = new CashDeskService(
          db,
          companies,
          org,
          failingAudit,
          invoices,
          undefined,
          undefined,
          undefined,
          purchases,
        );
        await assert.rejects(
          failed.record(user, { ...input, requestId: randomUUID() }),
          /Synthetic strict audit failure/,
        );
        assert.deepEqual(await snapshot(), stable);
        assert.deepEqual(await stock(), beforeStock);
      },
    );
    await check(
      `Purchases reverse AP, invoice, order, ERP and desk cash once on the requested journal date with cash-book flag ${enabled ? 'on' : 'off'}`,
      async () => {
        const reverse = {
          requestId: randomUUID(),
          businessDate: date,
          reason: 'Synthetic purchase correction',
        };
        const stable = await snapshot();
        await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'CLOSED' } });
        try {
          await assert.rejects(service.reverse(user, movement.id, reverse));
        } finally {
          await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
        }
        assert.deepEqual(await snapshot(), stable);
        const [reversal, duplicate] = await Promise.all([
          service.reverse(user, movement.id, reverse),
          service.reverse(user, movement.id, { ...reverse }),
        ]);
        assert.equal(duplicate.id, reversal.id);
        assert.equal((await service.reverse(user, movement.id, reverse)).id, reversal.id);
        const restored = await snapshot();
        for (const key of [
          'paid',
          'outstanding',
          'invoicePaid',
          'invoiceOutstanding',
          'orderPaid',
          'orderOutstanding',
          'cash',
          'desk',
          'supplier',
        ])
          assert.equal(restored[key], before[key], key + ' restored');
        assert.equal(restored.orderStatus, 'UNPAID');
        assert.equal(restored.entries, before.entries + 2);
        assert.equal(restored.journals, before.journals + 2);
        assert.equal(restored.payments, before.payments + 1);
        const journal = await db.journalEntry.findUniqueOrThrow({
          where: { id: reversal.journalEntryId },
        });
        assert.equal(journal.transactionDate.toISOString().slice(0, 10), date);
        assert.equal(num(journal.totalDebit), 25);
        assert.equal(num(journal.totalCredit), 25);
        await assert.rejects(
          service.reverse(user, movement.id, { ...reverse, requestId: randomUUID() }),
        );
        assert.deepEqual(await snapshot(), restored);
        assert.deepEqual(await stock(), beforeStock);
      },
    );
    if (!enabled)
      await check(
        'Existing Invoice Desk purchase payments remain linked, debit desk once and reverse without a second canonical purchase',
        async () => {
          const deskSupplier = await db.invoiceDeskSupplier.create({
            data: {
              companyId: f.company.id,
              canonicalSupplierId: f.supplier.id,
              name: f.supplier.name,
              nameKey: 'purchase-proof-' + suffix,
            },
          });
          const deskInvoice = await db.invoiceDeskInvoice.create({
            data: {
              ...scope,
              supplierId: deskSupplier.id,
              invoiceNumber: 'DESK-' + suffix,
              numberKey: suffix,
              description: 'Existing operational purchase',
              currency: 'TZS',
              invoiceDate: new Date(date),
              dueDate: new Date(date),
              totalAmount: 80,
            },
          });
          const request = {
            ...input,
            requestId: randomUUID(),
            payableId: undefined,
            invoiceId: deskInvoice.id,
            invoiceVersion: 1,
            amount: '10.00',
          };
          const state = await snapshot();
          const paid = await service.record(user, request);
          const acknowledged = await db.invoiceDeskInvoice.findUniqueOrThrow({
            where: { id: deskInvoice.id },
          });
          assert.equal(num(acknowledged.paidAmount), 10);
          assert.ok(paid.invoicePaymentId);
          assert.ok(paid.supplierPaymentId);
          assert.equal(paid.supplierId, f.supplier.id);
          assert.equal(paid.journalEntryId, null);
          assert.equal((await snapshot()).cash, state.cash);
          assert.equal((await snapshot()).desk, state.desk - 10);
          const beforeStaffReverse = await snapshot();
          const worker = await db.mobilePosEnrollment.findFirstOrThrow({
            where: {
              companyId: f.company.id,
              approvedRole: { in: ['CASHIER', 'STOCKIST'] },
              approvedAt: { not: null },
              userId: { not: null },
            },
          });
          for (const actor of [
            { ...user, tokenUse: 'mobile-pos' },
            { ...user, mobilePosRole: 'STOCKIST' },
            { ...user, id: worker.userId },
          ])
            await assert.rejects(
              service.reverse(actor, paid.id, {
                requestId: randomUUID(),
                businessDate: date,
                reason: 'Worker reversal bypass',
              }),
            );
          assert.deepEqual(await snapshot(), beforeStaffReverse);
          assert.equal(
            num(
              (await db.invoiceDeskInvoice.findUniqueOrThrow({ where: { id: deskInvoice.id } }))
                .paidAmount,
            ),
            10,
          );
          assert.equal(
            (await db.supplierPayment.findUniqueOrThrow({ where: { id: paid.supplierPaymentId } }))
              .status,
            'COMPLETED',
          );
          await service.reverse(user, paid.id, {
            requestId: randomUUID(),
            businessDate: date,
            reason: 'Synthetic desk correction',
          });
          assert.equal(
            num(
              (await db.invoiceDeskInvoice.findUniqueOrThrow({ where: { id: deskInvoice.id } }))
                .paidAmount,
            ),
            0,
          );
          assert.equal((await snapshot()).desk, state.desk);
          assert.equal((await snapshot()).outstanding, state.outstanding);
        },
      );
    if (!enabled)
      await check(
        'POS staff and historical password workers cannot post purchase payments with broad office permissions',
        async () => {
          const stable = await snapshot();
          for (const claims of [
            { tokenUse: 'mobile-pos' },
            { mobilePosRole: 'CASHIER' },
            { mobilePosRole: 'STOCKIST' },
          ])
            await assert.rejects(
              service.record({ ...user, ...claims }, { ...input, requestId: randomUUID() }),
            );
          const staff = await db.mobilePosEnrollment.findFirstOrThrow({
            where: {
              companyId: f.company.id,
              approvedRole: { in: ['CASHIER', 'STOCKIST'] },
              approvedAt: { not: null },
              userId: { not: null },
            },
          });
          await assert.rejects(
            service.record({ ...user, id: staff.userId }, { ...input, requestId: randomUUID() }),
          );
          assert.deepEqual(await snapshot(), stable);
        },
      );
  }
}
module.exports = { verifyCashPurchases };
