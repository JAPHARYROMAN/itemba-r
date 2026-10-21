/* Real receipt/payable/ledger proof using only a generated LOCAL disposable database. */
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '../tsconfig.json'),
});
require('reflect-metadata');
const { PrismaClient, Prisma } = require('@prisma/client');
const load = (file, name) => require(`../src/${file}`)[name];
const ReceiptPayablesService = load(
  'modules/receipt-payables/receipt-payables.service',
  'ReceiptPayablesService',
);
const GoodsReceivedNotesService = load(
  'modules/goods-received-notes/goods-received-notes.service',
  'GoodsReceivedNotesService',
);
const InventoryMovementsService = load(
  'modules/inventory-movements/inventory-movements.service',
  'InventoryMovementsService',
);
const PayablesService = load('modules/payables/payables.service', 'PayablesService');
const SupplierPaymentsService = load(
  'modules/supplier-payments/supplier-payments.service',
  'SupplierPaymentsService',
);
const PostingEngineService = load(
  'modules/accounting-engine/posting-engine.service',
  'PostingEngineService',
);
const AuditLogsService = load('modules/audit-logs/audit-logs.service', 'AuditLogsService');
const EntityCodeGeneratorService = load(
  'modules/entity-code-generator/entity-code-generator.service',
  'EntityCodeGeneratorService',
);
const ProfitService = load('modules/profit/profit.service', 'ProfitService');
const CompanyScopeService = load('common/services/company-scope.service', 'CompanyScopeService');
const AccountResolverService = load(
  'common/services/account-resolver.service',
  'AccountResolverService',
);
const AccountingControlService = load(
  'common/services/accounting-control.service',
  'AccountingControlService',
);

async function main() {
  const configured = new URL(process.env.DATABASE_URL);
  assert(
    ['localhost', '127.0.0.1'].includes(configured.hostname),
    'Proof requires local PostgreSQL.',
  );
  const name = `receipt_payables_verify_${Date.now()}`;
  assert(/^receipt_payables_verify_\d+$/.test(name));
  const disposable = new URL(configured);
  disposable.pathname = `/${name}`;
  const admin = new PrismaClient({ datasources: { db: { url: configured.toString() } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const db = new PrismaClient({ datasources: { db: { url: disposable.toString() } } });
  try {
    console.log('Initialising disposable receipt schema.');
    const root = path.resolve(__dirname, '../..');
    const pushed = spawnSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        path.join(root, 'database/prisma/schema.prisma'),
      ],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: disposable.toString() },
        encoding: 'utf8',
        timeout: 180000,
        windowsHide: true,
      },
    );
    assert.equal(pushed.status, 0, `Disposable schema failed: ${pushed.stderr}`);
    const date = new Date('2026-10-20T00:00:00Z');
    const group = await db.group.create({
      data: { code: 'RECEIPT-PROOF', name: 'Disposable receipt proof' },
    });
    const company = await db.company.create({
      data: { groupId: group.id, code: 'RECEIPT', name: 'Receipt fixture' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, code: 'PROOF', name: 'Proof', type: 'PETROLEUM' },
    });
    const branch = await db.branch.create({
      data: { divisionId: division.id, code: 'PROOF', name: 'Proof branch', type: 'FUEL_STATION' },
    });
    const user = await db.user.create({
      data: {
        companyId: company.id,
        email: 'receipt-proof@example.invalid',
        fullName: 'Receipt proof',
        passwordHash: 'DISPOSABLE',
      },
    });
    const auth = {
      id: user.id,
      companyId: company.id,
      roles: ['GROUP_SUPER_ADMIN'],
      roleScopes: ['GROUP'],
      companyAccess: [{ companyId: company.id, accessLevel: 'MANAGE' }],
    };
    const category = await db.productCategory.create({
      data: { companyId: company.id, name: 'Proof stock' },
    });
    const unit = await db.unitOfMeasure.create({ data: { name: 'Proof unit', symbol: 'P' } });
    const product = await db.product.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        baseUnitId: unit.id,
        name: 'Proof product',
        productCode: 'PROOF',
        defaultPurchasePrice: 30,
      },
    });
    const supplier = await db.supplier.create({
      data: { companyId: company.id, supplierCode: 'PROOF', name: 'Proof supplier' },
    });
    const fiscal = await db.fiscalYear.create({
      data: {
        companyId: company.id,
        name: '2026',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-12-31T00:00:00Z'),
      },
    });
    await db.accountingPeriod.create({
      data: {
        companyId: company.id,
        fiscalYearId: fiscal.id,
        name: 'October',
        startDate: new Date('2026-10-01T00:00:00Z'),
        endDate: new Date('2026-10-31T00:00:00Z'),
      },
    });
    const accounts = {};
    for (const [role, type, code] of [
      ['INVENTORY_ASSET', 'ASSET', '1300'],
      ['AP_CONTROL', 'LIABILITY', '2100'],
      ['CASH_ON_HAND', 'ASSET', '1000'],
      ['GENERAL_EXPENSE', 'EXPENSE', '6000'],
    ]) {
      accounts[role] = await db.chartOfAccount.create({
        data: {
          companyId: company.id,
          accountCode: code,
          accountName: role,
          accountType: type,
          accountSubType: role.toLowerCase(),
        },
      });
    }
    const audit = new AuditLogsService(db);
    const codes = new EntityCodeGeneratorService(db);
    const scope = new CompanyScopeService(db);
    const resolver = new AccountResolverService(db);
    const control = new AccountingControlService(db);
    const engine = new PostingEngineService(db, control, resolver);
    const receiptPayables = new ReceiptPayablesService(codes, resolver, engine, audit);
    const profit = new ProfitService(db, scope, audit);
    const inventory = new InventoryMovementsService(db, audit, codes, scope, profit);
    const grns = new GoodsReceivedNotesService(db, audit, scope, inventory, receiptPayables);
    const supplierPayments = new SupplierPaymentsService(db, audit, scope, resolver, engine, codes);
    const payables = new PayablesService(
      db,
      audit,
      scope,
      resolver,
      engine,
      codes,
      supplierPayments,
    );
    const base = {
      companyId: company.id,
      divisionId: division.id,
      branchId: branch.id,
      supplierId: supplier.id,
    };
    let sequence = 0;
    const createOrder = (quantity, amount, purchaseType = 'STOCK_PURCHASE') =>
      db.purchaseOrder.create({
        data: {
          ...base,
          purchaseOrderNumber: `PO-PROOF-${++sequence}`,
          orderDate: date,
          status: 'CONFIRMED',
          purchaseType,
          currency: 'TZS',
          totalAmount: amount,
          outstandingAmount: amount,
          createdById: user.id,
          lines: {
            create: {
              productId: product.id,
              unitId: unit.id,
              quantity,
              unitCost: new Prisma.Decimal(amount).div(quantity).toDecimalPlaces(4),
              lineTotal: amount,
            },
          },
        },
      });
    const createGrn = (order, quantity, cost = null) =>
      db.goodsReceivedNote.create({
        data: {
          ...base,
          purchaseOrderId: order?.id ?? null,
          grnNumber: `GRN-PROOF-${++sequence}`,
          receivedDate: date,
          receivedById: user.id,
          approvedById: user.id,
          status: 'APPROVED',
          lines: {
            create: {
              productId: product.id,
              unitId: unit.id,
              receivedQuantity: quantity,
              acceptedQuantity: quantity,
              unitCost: cost,
            },
          },
        },
      });
    const ensure = (order) =>
      db.$transaction(
        (tx) =>
          receiptPayables.ensureForPurchaseOrder({
            companyId: company.id,
            purchaseOrderId: order.id,
            transactionDate: date,
            userId: user.id,
            tx,
          }),
        { timeout: 20000 },
      );
    const currentPayable = async (order) => {
      const current = await db.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
      return db.payable.findUniqueOrThrow({ where: { id: current.payableId } });
    };
    const stockQuantity = async () =>
      (
        await db.inventoryBalance.findFirst({
          where: { companyId: company.id, productId: product.id, branchId: branch.id },
        })
      )?.quantityOnHand.toString() ?? '0';
    const stockValue = async () =>
      (
        await db.inventoryBalance.findFirst({
          where: { companyId: company.id, productId: product.id, branchId: branch.id },
        })
      )?.totalValue.toFixed(2) ?? '0.00';

    console.log('Checking partial receipts, payment and cumulative rounding.');
    const order = await createOrder(3, 100);
    const first = await createGrn(order, 1);
    await grns.post(first.id, auth);
    let payable = await currentPayable(order);
    assert.equal(payable.amount.toFixed(2), '33.33');
    assert.equal(await stockValue(), '33.33');
    await payables.recordPayment(payable.id, { amount: 10, paymentDate: '2026-10-20' }, auth);
    const second = await createGrn(order, 1);
    await grns.post(second.id, auth);
    payable = await currentPayable(order);
    assert.equal(payable.amount.toFixed(2), '66.67');
    assert.equal(payable.paidAmount.toFixed(2), '10.00');
    assert.equal(payable.outstandingAmount.toFixed(2), '56.67');
    assert.equal(await stockValue(), '66.67');
    assert.equal((await ensure(order)).postedAmount, '0.00');
    const third = await createGrn(order, 1);
    const repeated = await Promise.allSettled([
      grns.post(third.id, auth),
      grns.post(third.id, auth),
    ]);
    assert.equal(repeated.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(repeated.filter((r) => r.status === 'rejected').length, 1);
    payable = await currentPayable(order);
    assert.equal(payable.amount.toFixed(2), '100.00');
    assert.equal(payable.outstandingAmount.toFixed(2), '90.00');
    assert.equal(await stockQuantity(), '3');
    assert.equal(await stockValue(), '100.00');
    const ownLedger = await db.journalEntryLine.aggregate({
      where: {
        accountId: accounts.AP_CONTROL.id,
        journalEntry: { companyId: company.id, status: 'POSTED' },
      },
      _sum: { debit: true, credit: true },
    });
    assert.equal(ownLedger._sum.credit.toFixed(2), '100.00');
    assert.equal(ownLedger._sum.debit.toFixed(2), '10.00');

    console.log('Checking concurrent separate GRNs on the same purchase order.');
    const raceOrder = await createOrder(2, 100);
    const [raceA, raceB] = await Promise.all([createGrn(raceOrder, 1), createGrn(raceOrder, 1)]);
    await Promise.all([grns.post(raceA.id, auth), grns.post(raceB.id, auth)]);
    const racePayable = await currentPayable(raceOrder);
    assert.equal(racePayable.amount.toFixed(2), '100.00');
    assert.equal(
      await db.payable.count({ where: { sourceType: 'PurchaseOrder', sourceId: raceOrder.id } }),
      1,
    );
    assert.equal(await stockQuantity(), '5');
    const repeatedEnsure = await Promise.all([ensure(raceOrder), ensure(raceOrder)]);
    assert(repeatedEnsure.every((result) => result.postedAmount === '0.00'));

    console.log('Checking reuse of the existing approved invoice liability.');
    const invoiceOrder = await createOrder(1, 75);
    const invoice = await db.supplierInvoice.create({
      data: {
        ...base,
        purchaseOrderId: invoiceOrder.id,
        supplierInvoiceNumber: 'INV-PROOF',
        invoiceDate: date,
        totalAmount: 75,
        outstandingAmount: 75,
        status: 'APPROVED',
        createdById: user.id,
      },
    });
    const invoicePayable = await db.payable.create({
      data: {
        ...base,
        payableNumber: 'AP-INVOICE-PROOF',
        sourceType: 'SupplierInvoice',
        sourceId: invoice.id,
        supplierName: supplier.name,
        amount: 75,
        outstandingAmount: 75,
        issueDate: date,
      },
    });
    await db.$transaction(async (tx) => {
      const journal = await engine.postLines(
        {
          companyId: company.id,
          transactionDate: date,
          userId: user.id,
          moduleName: 'supplier-invoices',
          description: 'Invoice fixture liability',
          referenceType: 'SupplierInvoice',
          referenceId: invoice.id,
          lines: [
            { accountId: accounts.INVENTORY_ASSET.id, debit: 75, credit: 0 },
            { accountId: accounts.AP_CONTROL.id, debit: 0, credit: 75 },
          ],
        },
        tx,
      );
      await tx.payable.update({
        where: { id: invoicePayable.id },
        data: { journalEntryId: journal.id },
      });
      await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: { payableId: invoicePayable.id },
      });
    });
    const invoiceGrn = await createGrn(invoiceOrder, 1);
    const journalsBeforeInvoiceReceipt = await db.journalEntry.count();
    await grns.post(invoiceGrn.id, auth);
    assert.equal((await currentPayable(invoiceOrder)).id, invoicePayable.id);
    assert.equal(await db.journalEntry.count(), journalsBeforeInvoiceReceipt);

    console.log(
      'Checking approved purchase variance rejection and mixed stock/service allocation.',
    );
    const landedOrder = await createOrder(1, 25);
    const landedGrn = await createGrn(landedOrder, 1, 40);
    const valueBeforeLanded = new Prisma.Decimal(await stockValue());
    await assert.rejects(
      () => grns.post(landedGrn.id, auth),
      /cost differs from the approved purchase order/,
    );
    assert.equal(
      await db.payable.count({ where: { sourceType: 'PurchaseOrder', sourceId: landedOrder.id } }),
      0,
    );
    assert.equal(
      (await db.goodsReceivedNote.findUniqueOrThrow({ where: { id: landedGrn.id } })).status,
      'APPROVED',
    );
    assert.equal(
      (await db.purchaseOrder.findUniqueOrThrow({ where: { id: landedOrder.id } })).status,
      'CONFIRMED',
    );
    assert.equal(
      new Prisma.Decimal(await stockValue()).minus(valueBeforeLanded).toFixed(2),
      '0.00',
    );
    const serviceProduct = await db.product.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        baseUnitId: unit.id,
        productCode: 'SERVICE',
        name: 'Proof service',
        productType: 'SERVICE',
        trackInventory: false,
        defaultPurchasePrice: 10,
      },
    });
    const mixedOrder = await createOrder(2, 100);
    await db.purchaseOrderLine.create({
      data: {
        purchaseOrderId: mixedOrder.id,
        productId: serviceProduct.id,
        unitId: unit.id,
        quantity: 3,
        unitCost: 10,
        lineTotal: 36,
      },
    });
    await db.purchaseOrder.update({
      where: { id: mixedOrder.id },
      data: { totalAmount: 136, outstandingAmount: 136 },
    });
    const mixedGrn = await createGrn(mixedOrder, 2);
    await db.goodsReceivedNoteLine.create({
      data: {
        goodsReceivedNoteId: mixedGrn.id,
        productId: serviceProduct.id,
        unitId: unit.id,
        receivedQuantity: 3,
        acceptedQuantity: 3,
      },
    });
    const valueBeforeMixed = new Prisma.Decimal(await stockValue());
    await grns.post(mixedGrn.id, auth);
    const mixedPayable = await currentPayable(mixedOrder);
    assert.equal(mixedPayable.amount.toFixed(2), '136.00');
    assert.equal(
      new Prisma.Decimal(await stockValue()).minus(valueBeforeMixed).toFixed(2),
      '100.00',
    );
    assert.equal(
      await db.inventoryMovement.count({
        where: { referenceType: 'GoodsReceivedNote', referenceId: mixedGrn.id },
      }),
      1,
    );
    const mixedJournal = await db.journalEntry.findUniqueOrThrow({
      where: { id: mixedPayable.journalEntryId },
      include: { lines: true },
    });
    assert.equal(
      mixedJournal.lines
        .find((line) => line.accountId === accounts.INVENTORY_ASSET.id)
        .debit.toFixed(2),
      '100.00',
    );
    assert.equal(
      mixedJournal.lines
        .find((line) => line.accountId === accounts.GENERAL_EXPENSE.id)
        .debit.toFixed(2),
      '36.00',
    );
    const apLine = mixedJournal.lines.find((line) => line.accountId === accounts.AP_CONTROL.id);
    assert.equal(apLine.credit.toFixed(2), '136.00');
    assert.equal(apLine.supplierId, supplier.id);
    assert.equal(apLine.partyType, 'SUPPLIER');

    console.log('Checking full rollback of stock, receipt, payable, ledger and audits.');
    const rollbackOrder = await createOrder(1, 25);
    const rollbackGrn = await createGrn(rollbackOrder, 1);
    const before = await Promise.all([
      db.payable.count(),
      db.journalEntry.count(),
      db.inventoryMovement.count(),
      db.auditLog.count(),
      stockQuantity(),
    ]);
    const failAudit = {
      logStrictInTransaction: async (tx, input) => {
        if (input.action === 'GOODS_RECEIVED_NOTE_POST')
          throw new Error('Simulated final receipt audit failure');
        return audit.logStrictInTransaction(tx, input);
      },
    };
    const rollbackService = new GoodsReceivedNotesService(
      db,
      failAudit,
      scope,
      inventory,
      receiptPayables,
    );
    await assert.rejects(
      () => rollbackService.post(rollbackGrn.id, auth),
      /final receipt audit failure/,
    );
    assert.deepEqual(
      await Promise.all([
        db.payable.count(),
        db.journalEntry.count(),
        db.inventoryMovement.count(),
        db.auditLog.count(),
        stockQuantity(),
      ]),
      before,
    );
    assert.equal(
      (await db.goodsReceivedNote.findUniqueOrThrow({ where: { id: rollbackGrn.id } })).status,
      'APPROVED',
    );
    assert.equal(
      (await db.purchaseOrder.findUniqueOrThrow({ where: { id: rollbackOrder.id } })).status,
      'CONFIRMED',
    );
    assert.equal(
      (await db.goodsReceivedNoteLine.findFirst({ where: { goodsReceivedNoteId: rollbackGrn.id } }))
        .unitCost,
      null,
    );

    console.log('Checking standalone GRN and explicit cash exclusion.');
    const standalone = await createGrn(null, 2, 60);
    await grns.post(standalone.id, auth);
    const standalonePayable = await db.payable.findFirstOrThrow({
      where: { sourceType: 'GoodsReceivedNote', sourceId: standalone.id },
    });
    assert.equal(standalonePayable.amount.toFixed(2), '120.00');
    await payables.recordPayment(
      standalonePayable.id,
      { amount: 120, paymentDate: '2026-10-20' },
      auth,
    );
    const paidStandalone = await db.payable.findUniqueOrThrow({
      where: { id: standalonePayable.id },
    });
    assert.equal(paidStandalone.status, 'PAID');
    assert.equal(paidStandalone.outstandingAmount.toFixed(2), '0.00');
    await db.$transaction(async (tx) =>
      assert.equal(
        (
          await receiptPayables.ensureForGrn({
            companyId: company.id,
            goodsReceivedNoteId: standalone.id,
            transactionDate: date,
            userId: user.id,
            tx,
          })
        ).postedAmount,
        '0.00',
      ),
    );
    const tinyGrn = await createGrn(null, 1, 0.0049);
    const beforeTiny = await db.inventoryBalance.findFirstOrThrow({
      where: { companyId: company.id, productId: product.id, branchId: branch.id },
    });
    await grns.post(tinyGrn.id, auth);
    const afterTiny = await db.inventoryBalance.findFirstOrThrow({ where: { id: beforeTiny.id } });
    assert.equal(afterTiny.totalValue.toFixed(2), beforeTiny.totalValue.toFixed(2));
    assert.equal(
      afterTiny.averageCost.toFixed(4),
      beforeTiny.totalValue.div(beforeTiny.quantityOnHand.plus(1)).toFixed(4),
    );
    assert.equal(
      (
        await db.inventoryMovement.findFirstOrThrow({
          where: { referenceType: 'GoodsReceivedNote', referenceId: tinyGrn.id },
        })
      ).totalCost.toFixed(2),
      '0.00',
    );
    const cashOrder = await createOrder(1, 20, 'CASH_PURCHASE');
    await db.purchaseOrder.update({ where: { id: cashOrder.id }, data: { status: 'RECEIVED' } });
    assert.equal(await ensure(cashOrder), null);
    assert.equal(
      await db.payable.count({ where: { sourceType: 'PurchaseOrder', sourceId: cashOrder.id } }),
      0,
    );
    console.log(
      JSON.stringify({
        ok: true,
        checks: [
          'real stock purchase GRN accounting',
          'partial accepted gross rounding',
          'inventory value equals gross receipt ledger including partial cent remainders',
          'topup after actual payable payment',
          'repeated GRN refuses duplicate stock/liability',
          'concurrent distinct GRNs share one payable',
          'concurrent repeated ensures post no delta',
          'existing invoice liability reused without journal duplication',
          'linked GRN value variance rejects and rolls back pending approved purchase review',
          'mixed stock/service liability splits inventory and expense without stock inflation',
          'receipt audit failure rolls back stock, costs, status, payable, ledger and audits',
          'standalone GRN accounting and full supplier payment',
          'zero-cent exact receipt delta preserves rounded stock value and WAC',
          'cash purchase exclusion',
        ],
      }),
    );
  } finally {
    await db.$disconnect();
    assert(/^receipt_payables_verify_\d+$/.test(name));
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
