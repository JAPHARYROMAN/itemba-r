/* Compiled-service proof on a generated disposable PostgreSQL database.
 * Requires loopback PostgreSQL. Never uses existing app business records.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
require('reflect-metadata');
const compiled = process.env.POS_PROOF_COMPILED === '1';
const unifiedCashBook = process.env.POS_PROOF_CASH_BOOK_UNIFIED === '1';
if (!compiled)
  require('ts-node').register({
    transpileOnly: true,
    project: path.join(__dirname, '../tsconfig.json'),
  });
const load = (file, name) =>
  require(path.join(__dirname, compiled ? '../dist' : '../src', file))[name];
async function main() {
  const server = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(server.hostname), 'Proof requires local PostgreSQL.');
  const name = `pos_selling_proof_${randomUUID().replaceAll('-', '')}`;
  assert(/^pos_selling_proof_[a-f0-9]{32}$/.test(name));
  server.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: server.href } } });
  let db,
    created = false;
  const checks = [];
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created = true;
    server.pathname = '/' + name;
    const setup = spawnSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        path.resolve(__dirname, '../../database/prisma/schema.prisma'),
      ],
      {
        env: { ...process.env, DATABASE_URL: server.href },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 180000,
      },
    );
    assert.equal(setup.status, 0, 'Disposable schema could not be initialised.');
    db = new PrismaClient({ datasources: { db: { url: server.href } } });
    const group = await db.group.create({ data: { name: 'POS proof', code: 'POSPROOF' } });
    const company = await db.company.create({
      data: { groupId: group.id, code: 'POSPROOF', name: 'POS proof company' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, code: 'RETAIL', name: 'Retail', type: 'OTHER' },
    });
    const branch = await db.branch.create({
      data: { divisionId: division.id, code: 'COUNTER', name: 'Counter', type: 'BRANCH' },
    });
    const otherBranch = await db.branch.create({
      data: { divisionId: division.id, code: 'OTHER', name: 'Other', type: 'BRANCH' },
    });
    const scope = { companyId: company.id, divisionId: division.id, branchId: branch.id };
    const actor = await db.user.create({
      data: {
        email: 'pos-proof@example.invalid',
        fullName: 'Proof cashier',
        passwordHash: 'DISABLED_PROOF_ONLY',
        companyId: company.id,
      },
    });
    const rep = await db.employee.create({
      data: {
        ...scope,
        employeeCode: 'REP',
        firstName: 'Proof',
        lastName: 'Cashier',
        fullName: 'Proof cashier',
        userId: actor.id,
        hireDate: new Date(),
      },
    });
    const user = {
      id: actor.id,
      email: actor.email,
      companyId: company.id,
      roles: ['GROUP_SUPER_ADMIN'],
      roleScopes: ['GROUP'],
      permissions: [
        'mobile_pos_lite.use',
        'mobile_pos_lite.purchase',
        'mobile_pos_lite.stock_count',
        'sales.create',
        'sales.view',
        'cash_desk.view',
        'cash_accounts.view',
        'receivables.view',
        'customer-payments.view',
        'inventory.view',
        'customer-payments.create',
        'credit-notes.create',
        'credit-notes.issue',
        'refunds.create',
        'refunds.pay',
      ],
      companyAccess: [{ companyId: company.id, accessLevel: 'MANAGE' }],
      divisionAccess: [],
      branchAccess: [],
    };
    const customer = await db.customer.create({
      data: { ...scope, name: 'Proof customer', customerCode: 'CUSTOMER' },
    });
    const account = await db.cashAccount.create({
      data: {
        ...scope,
        accountName: 'Proof cash till',
        accountType: 'CASH_ON_HAND',
        currentBalance: 0,
      },
    });
    const unit = await db.unitOfMeasure.create({ data: { name: 'Piece', symbol: 'pc' } });
    const category = await db.productCategory.create({
      data: { companyId: company.id, name: 'Proof products' },
    });
    const product = await db.product.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        baseUnitId: unit.id,
        productCode: 'WATER',
        name: 'Proof water',
        defaultSellingPrice: 1200,
        defaultPurchasePrice: 500,
        trackInventory: true,
      },
    });
    await db.inventoryBalance.create({
      data: {
        ...scope,
        productId: product.id,
        quantityOnHand: 100,
        averageCost: 500,
        totalValue: 50000,
      },
    });
    await db.productBatch.create({
      data: {
        companyId: company.id,
        branchId: branch.id,
        productId: product.id,
        unitId: unit.id,
        batchNumber: 'OPENING',
        initialQuantity: 100,
        remainingQuantity: 100,
        unitCost: 500,
        receivedDate: new Date(),
      },
    });
    const year = new Date().getUTCFullYear(),
      startDate = new Date(`${year}-01-01`),
      endDate = new Date(`${year}-12-31T23:59:59Z`);
    const fiscal = await db.fiscalYear.create({
      data: { companyId: company.id, name: String(year), startDate, endDate },
    });
    await db.accountingPeriod.create({
      data: {
        companyId: company.id,
        fiscalYearId: fiscal.id,
        name: String(year),
        startDate,
        endDate,
      },
    });
    for (const [role, accountType] of [
      ['CASH_ON_HAND', 'ASSET'],
      ['AR_CONTROL', 'ASSET'],
      ['SALES_REVENUE', 'INCOME'],
      ['COST_OF_GOODS_SOLD', 'COST_OF_GOODS_SOLD'],
      ['INVENTORY_ASSET', 'ASSET'],
      ['TAX_VAT_PAYABLE', 'LIABILITY'],
      ['AP_CONTROL', 'LIABILITY'],
      ['INVENTORY_ADJUSTMENT_VARIANCE', 'EXPENSE'],
    ]) {
      await db.chartOfAccount.create({
        data: {
          companyId: company.id,
          accountCode: role,
          accountName: role,
          accountSubType: role.toLowerCase(),
          accountType,
        },
      });
    }
    const secret = randomUUID();
    const terminal = await db.mobilePosTerminal.create({
      data: {
        ...scope,
        terminalCode: 'POS-PROOF',
        name: 'Proof terminal',
        assignedUserId: actor.id,
        salespersonId: rep.id,
        generalCustomerId: customer.id,
        creditEnabled: true,
        uiVersion: 3,
        deviceSecretHash: createHash('sha256').update(secret).digest('hex'),
        paymentMethods: {
          create: { paymentMethod: 'CASH', label: 'Cash', cashAccountId: account.id },
        },
      },
    });
    const CompanyScope = load('common/services/company-scope.service', 'CompanyScopeService');
    const OrganizationScope = load(
      'common/services/organization-scope.service',
      'OrganizationScopeService',
    );
    const Audit = load('modules/audit-logs/audit-logs.service', 'AuditLogsService');
    const Codes = load(
      'modules/entity-code-generator/entity-code-generator.service',
      'EntityCodeGeneratorService',
    );
    const Profit = load('modules/profit/profit.service', 'ProfitService');
    const Movements = load(
      'modules/inventory-movements/inventory-movements.service',
      'InventoryMovementsService',
    );
    const Resolver = load('common/services/account-resolver.service', 'AccountResolverService');
    const Control = load('common/services/accounting-control.service', 'AccountingControlService');
    const Engine = load('modules/accounting-engine/posting-engine.service', 'PostingEngineService');
    const Tax = load('modules/tax-auto-apply/tax-auto-apply.service', 'TaxAutoApplyService');
    const Sales = load('modules/sales-orders/sales-orders.service', 'SalesOrdersService');
    const Delivery = load('modules/delivery-notes/delivery-notes.service', 'DeliveryNotesService');
    const Mobile = load('modules/mobile-pos-lite/mobile-pos-lite.service', 'MobilePosLiteService');
    const Cash = load(
      'modules/cash-desk/cash-sales-connection.service',
      'CashSalesConnectionService',
    );
    const Reports = load('modules/desk-reports/business-reports.service', 'BusinessReportsService');
    const companies = new CompanyScope(db),
      org = new OrganizationScope(db),
      audit = new Audit(db),
      codes = new Codes(db);
    const resolver = new Resolver(db),
      engine = new Engine(db, new Control(db), resolver),
      profit = new Profit(db, companies, audit);
    const movements = new Movements(db, audit, codes, companies, profit);
    const sales = new Sales(
      db,
      audit,
      movements,
      new Tax(db, companies, audit),
      codes,
      companies,
      engine,
      resolver,
      profit,
    );
    const Generated = load(
      'modules/generated-documents/generated-documents.service',
      'GeneratedDocumentsService',
    );
    const documents = new Generated(db, audit, null, companies);
    const Purchases = load('modules/purchase-orders/purchase-orders.service', 'PurchaseOrdersService');
    const GoodsReceived = load('modules/goods-received-notes/goods-received-notes.service', 'GoodsReceivedNotesService');
    const Adjustments = load('modules/stock-adjustments/stock-adjustments.service', 'StockAdjustmentsService');
    const pos = new Mobile(
      db,
      companies,
      audit,
      sales,
      new Purchases(db, audit, movements, new Tax(db, companies, audit), codes, companies, engine, resolver, profit),
      new GoodsReceived(db, audit, companies, movements),
      codes,
      documents,
      new Adjustments(db, audit, movements, companies, engine, resolver),
      new Delivery(db, audit, codes),
    );
    const cash = new Cash(db, companies, org),
      reports = new Reports(db, companies, org);
    const original = {
      paymentMethod: 'CASH',
      customerId: customer.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: product.id, quantity: 2 }],
    };
    const sale = await pos.createSale(terminal.terminalCode, secret, original, user);
    assert.equal(Number(sale.totalAmount), 2400);
    checks.push('Cash sale uses canonical totals');
    const outcome = await pos.checkoutOutcome(
      terminal.terminalCode,
      secret,
      original.idempotencyKey,
      user,
    );
    assert.equal(outcome.state, 'confirmed');
    assert.equal(outcome.sale.id, sale.id);
    const replay = await pos.createSale(terminal.terminalCode, secret, original, user);
    assert.equal(replay.id, sale.id);
    assert.equal(await db.salesOrder.count(), 1);
    assert.equal(await db.inventoryMovement.count({ where: { movementType: 'SALE_ISSUE' } }), 1);
    assert.equal(
      Number((await db.cashAccount.findUnique({ where: { id: account.id } })).currentBalance),
      2400,
    );
    checks.push(
      'Lost response, lookup and original-key replay create one sale, stock issue and cash receipt',
    );
    const credit = await pos.createSale(
      terminal.terminalCode,
      secret,
      {
        ...original,
        paymentMethod: 'CREDIT',
        idempotencyKey: randomUUID(),
        lines: [{ productId: product.id, quantity: 1 }],
      },
      user,
    );
    assert.equal(Number(credit.outstandingAmount), 1200);
    assert.equal(
      Number(
        (
          await db.inventoryBalance.findFirst({
            where: { productId: product.id, branchId: branch.id },
          })
        ).quantityOnHand,
      ),
      97,
    );
    assert.equal(
      Number((await db.cashAccount.findUnique({ where: { id: account.id } })).currentBalance),
      2400,
    );
    checks.push('Credit creates debt and one stock issue without adding cash');
    const desk = await sales.findAll({ ...scope, page: 1, limit: 20 }, user);
    assert.deepEqual(new Set(desk.data.map((s) => s.id)), new Set([sale.id, credit.id]));
    checks.push('Sales Desk reads the same sale IDs');
    const date = new Date().toISOString().slice(0, 10);
    const collection = await cash.read(user, { ...scope, date, page: 1 });
    const tzs = collection.currencies.find((c) => c.currency === 'TZS');
    assert.equal(tzs.balance, '2400.00');
    assert.equal(tzs.outstanding, '1200.00');
    assert.equal(tzs.received, '2400.00');
    checks.push('Cash Desk projects cash and outstanding credit without a second register entry');
    const report = await reports.read(user, { ...scope, kind: 'sales' });
    assert.equal(report.rows.length, 2);
    assert.equal(Number(report.totals[0].amount), 3600);
    checks.push('Reports reads both canonical sales');
    const history = await pos.salesHistory(terminal.terminalCode, secret, user);
    assert.equal(history.count, 2);
    assert.equal(history.totalAmount, 3600);
    assert.equal(history.sales.find((s) => s.id === credit.id).status, 'CREDIT');
    assert.equal(history.sales.find((s) => s.id === sale.id).status, 'PAID');
    checks.push('Transactions exposes paid and credit states with cost-blind selling lines');
    const entries = await db.journalEntry.findMany({
      where: { referenceType: 'SalesOrder' },
      include: { lines: true },
    });
    assert.equal(entries.length, 2);
    for (const entry of entries)
      assert.equal(
        entry.lines.reduce((s, l) => s + Number(l.debit), 0),
        entry.lines.reduce((s, l) => s + Number(l.credit), 0),
      );
    checks.push('Each sale has one balanced journal');
    const restricted = {
      ...user,
      roleScopes: ['BRANCH'],
      branchAccess: [{ branchId: otherBranch.id, accessLevel: 'WRITE' }],
    };
    assert.equal((await cash.read(restricted, { date, page: 1 })).outstanding.total, 0);
    await assert.rejects(
      pos.checkoutOutcome(terminal.terminalCode, 'wrong-secret', original.idempotencyKey, user),
    );
    await assert.rejects(
      pos.createSale(
        terminal.terminalCode,
        secret,
        { ...original, idempotencyKey: randomUUID() },
        {
          ...user,
          companyId: undefined,
          companyAccess: [{ companyId: company.id, accessLevel: 'READ' }],
        },
      ),
    );
    assert.equal(await db.salesOrder.count(), 2);
    checks.push(
      'Wrong device and read-only company cannot post; other branch cannot read collections',
    );
    assert.equal(await db.cashDeskMovement.count(), 0);
    assert.equal(await db.salesDeskSale.count(), 0);
    checks.push('No mirrored direct-entry sales or cash movements');

    const Payments = load(
      'modules/customer-payments/customer-payments.service',
      'CustomerPaymentsService',
    );
    const Credits = load('modules/credit-notes/credit-notes.service', 'CreditNotesService');
    const Refunds = load('modules/refunds/refunds.service', 'RefundsService');
    const Lifecycle = load(
      'modules/mobile-pos-lite/pos-transactions.service',
      'PosTransactionsService',
    );
    const CashBook = load('modules/cash-book/cash-book.service', 'CashBookService');
    const cashBook = new CashBook(db, audit, companies, { get: () => unifiedCashBook ? 'true' : 'false' });
    const lifecycle = new Lifecycle(
      db,
      pos,
      new Payments(db, audit, companies, resolver, engine, codes, cashBook),
      new Credits(db, audit, companies, resolver, engine, codes, movements, profit),
      new Refunds(db, audit, companies, resolver, engine, codes, cashBook),
      documents,
      org,
    );
    const mobile = await db.cashAccount.create({
      data: { ...scope, accountName: 'Mobile', accountType: 'MOBILE_MONEY' },
    });
    await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode: 'MOBILE_MONEY',
        accountName: 'Mobile',
        accountSubType: 'mobile_money',
        accountType: 'ASSET',
      },
    });
    await db.mobilePosTerminalPayment.create({
      data: {
        terminalId: terminal.id,
        paymentMethod: 'MOBILE_MONEY',
        cashAccountId: mobile.id,
        label: 'Mobile',
      },
    });
    const splitRequest = {
      ...original,
      paymentMethod: 'MIXED',
      idempotencyKey: randomUUID(),
      expectedTotal: 4800,
      lines: [{ productId: product.id, quantity: 4 }],
      payments: [
        { method: 'CASH', amount: 1000 },
        { method: 'MOBILE_MONEY', amount: 800, reference: 'PROOF-MOBILE' },
      ],
    };
    const split = await pos.createSale(terminal.terminalCode, secret, splitRequest, user);
    assert.equal(Number(split.paidAmount), 1800);
    assert.equal(Number(split.outstandingAmount), 3000);
    assert.equal(
      (await pos.createSale(terminal.terminalCode, secret, splitRequest, user)).id,
      split.id,
    );
    await assert.rejects(
      pos.createSale(
        terminal.terminalCode,
        secret,
        { ...splitRequest, payments: [{ method: 'CASH', amount: 1800 }] },
        user,
      ),
    );
    checks.push(
      'Split/partial sale records original accounts and debt once; changed allocations refuse replay',
    );
    if (unifiedCashBook) {
      for (const id of [account.id, mobile.id]) {
        const erp = await db.cashAccount.findUnique({where:{id}});
        const mapped = await db.cashDeskAccount.create({data:{...scope, erpCashAccountId:id, name:erp.accountName, nameKey:id, kind:'CASH', currency:'TZS', openingDate:new Date(date), balance:erp.currentBalance}});
        const opening = await db.cashDeskMovement.create({data:{requestId:randomUUID(), payloadKey:'proof-opening', kind:'OPENING', amount:erp.currentBalance, currency:'TZS', businessDate:new Date(date), description:'Synthetic opening for integration proof', reference:'PROOF', createdBy:user.id, actorName:'Proof'}});
        await db.cashDeskEntry.create({data:{movementId:opening.id, accountId:mapped.id, businessDate:new Date(date), amount:erp.currentBalance}});
      }
    }
    const collect = { requestId: randomUUID(), method: 'CASH', amount: 500 };
    const responses = await Promise.all([
      lifecycle.collect(terminal.terminalCode, secret, split.id, collect, user),
      lifecycle.collect(terminal.terminalCode, secret, split.id, collect, user),
    ]);
    assert.equal(responses[0].id, responses[1].id);
    assert.equal(await db.customerPayment.count(), 1);
    assert.equal(
      (await lifecycle.detail(terminal.terminalCode, secret, split.id, user)).outstanding,
      2500,
    );
    assert.equal(
      (await lifecycle.outcome(terminal.terminalCode, secret, collect.requestId, user)).state,
      'confirmed',
    );
    checks.push(
      'Concurrent collection retries share one customer payment, cash receipt and debt reduction',
    );
    const splitLine = (await lifecycle.detail(terminal.terminalCode, secret, split.id, user))
      .lines[0];
    const ret = {
      requestId: randomUUID(),
      reason: 'Synthetic returned goods',
      refundMethod: 'CASH',
      lines: [{ lineId: splitLine.id, quantity: 3, disposition: 'RESTOCK' }],
    };
    const returned = await lifecycle.returnSale(terminal.terminalCode, secret, split.id, ret, user);
    assert.equal(returned.amount, 3600);
    assert.equal(returned.debtReduced, 2500);
    assert.equal(returned.refundAmount, 1100);
    assert.equal(
      (await lifecycle.returnSale(terminal.terminalCode, secret, split.id, ret, user)).id,
      returned.id,
    );
    assert.equal(await db.refund.count({ where: { status: 'PAID' } }), 1);
    const adjustedSale = await db.salesOrder.findUnique({ where: { id: split.id } });
    assert.equal(Number(adjustedSale.outstandingAmount), 0);
    assert.equal(Number(adjustedSale.paidAmount), 2300);
    assert.equal(adjustedSale.status, 'PAID');
    assert.equal(
      (await lifecycle.detail(terminal.terminalCode, secret, split.id, user)).outstanding,
      0,
    );
    assert.equal(
      Number(
        (
          await db.inventoryBalance.findFirst({
            where: { productId: product.id, branchId: branch.id },
          })
        ).quantityOnHand,
      ),
      96,
    );
    checks.push('Return first reduces shared debt, refunds only paid value and restocks once');
    await assert.rejects(
      lifecycle.returnSale(
        terminal.terminalCode,
        secret,
        split.id,
        {
          ...ret,
          requestId: randomUUID(),
          lines: [{ lineId: splitLine.id, quantity: 2, disposition: 'RESTOCK' }],
        },
        user,
      ),
    );
    const damaged = await lifecycle.returnSale(
      terminal.terminalCode,
      secret,
      split.id,
      {
        ...ret,
        requestId: randomUUID(),
        lines: [{ lineId: splitLine.id, quantity: 1, disposition: 'DAMAGED' }],
      },
      user,
    );
    assert.equal(damaged.refundAmount, 1200);
    assert.equal(
      Number(
        (
          await db.inventoryBalance.findFirst({
            where: { productId: product.id, branchId: branch.id },
          })
        ).quantityOnHand,
      ),
      96,
    );
    checks.push('Over-return is refused; damaged goods never become saleable stock');
    const financial = await cash.read(user, { ...scope, date, page: 1 });
    const totals = financial.currencies.find((c) => c.currency === 'TZS');
    assert.equal(totals.outstanding, '1200.00');
    assert.equal(
      Number((await db.cashAccount.findUnique({ where: { id: account.id } })).currentBalance),
      1600,
    );
    assert.equal(
      Number((await db.cashAccount.findUnique({ where: { id: mobile.id } })).currentBalance),
      800,
    );
    assert.equal(totals.received, '4700.00');
    checks.push(
      'Cash Desk keeps original allocations separate from collections and actual account balances',
    );
    if (unifiedCashBook) {
      assert.equal(await db.cashDeskMovement.count({where:{customerPaymentId:{not:null}}}),1);
      assert.equal(await db.cashDeskMovement.count({where:{refundId:{not:null}}}),2);
      for (const id of [account.id,mobile.id]) {
        const erp=await db.cashAccount.findUnique({where:{id}});
        const desk=await db.cashDeskAccount.findUnique({where:{erpCashAccountId:id}});
        assert.equal(desk.balance.toFixed(2),erp.currentBalance.toFixed(2));
      }
      checks.push('Unified cash book mirrors collections and refunds exactly once without doubling Sales Desk receipts');
    }
    const ar = await resolver.resolve(company.id, 'AR_CONTROL', db);
    const arLines = await db.journalLine.findMany({where:{accountId:ar.id}});
    assert(arLines.length>0);
    assert(arLines.every(line=>line.partyType==='CUSTOMER' && line.customerId===customer.id));
    checks.push('Sales, split debt, collections and credit notes carry the same customer on every AR control line');
    for (const j of await db.journalEntry.findMany({ include: { lines: true } }))
      assert.equal(
        j.lines.reduce((n, l) => n + Number(l.debit), 0),
        j.lines.reduce((n, l) => n + Number(l.credit), 0),
      );
    await assert.rejects(
      lifecycle.collect(
        terminal.terminalCode,
        secret,
        credit.id,
        { ...collect, requestId: randomUUID() },
        { ...user, permissions: ['mobile_pos_lite.use'] },
      ),
    );
    await assert.rejects(
      lifecycle.returnSale(
        terminal.terminalCode,
        secret,
        sale.id,
        {
          ...ret,
          requestId: randomUUID(),
          lines: [
            {
              lineId: (await lifecycle.detail(terminal.terminalCode, secret, sale.id, user))
                .lines[0].id,
              quantity: 1,
              disposition: 'RESTOCK',
            },
          ],
        },
        { ...user, permissions: user.permissions.filter((p) => p !== 'refunds.pay') },
      ),
    );
    assert.equal(await db.creditNote.count(), 2);
    assert.equal(await db.posTransactionAction.count(), 3);
    checks.push('Denied refund rolls back its credit, stock and debt; journals remain balanced');

    await assert.rejects(lifecycle.detail(terminal.terminalCode, secret, split.id, restricted));
    await assert.rejects(
      lifecycle.outcome(terminal.terminalCode, secret, collect.requestId, restricted),
    );
    await assert.rejects(
      lifecycle.collect(
        terminal.terminalCode,
        secret,
        credit.id,
        { ...collect, requestId: randomUUID() },
        restricted,
      ),
    );
    await assert.rejects(
      lifecycle.collect(
        terminal.terminalCode,
        secret,
        credit.id,
        { ...collect, requestId: randomUUID(), amount: 1300 },
        user,
      ),
    );
    assert.equal(await db.customerPayment.count(), 1);
    checks.push(
      'Revoked branch access cannot read, recover or collect; overcollection leaves balances intact',
    );
    const unchangedStock = Number(
      (
        await db.inventoryBalance.findFirst({
          where: { productId: product.id, branchId: branch.id },
        })
      ).quantityOnHand,
    );
    const paidLine = (await lifecycle.detail(terminal.terminalCode, secret, sale.id, user))
      .lines[0];
    await db.cashAccount.update({ where: { id: account.id }, data: { currentBalance: 0 } });
    await assert.rejects(
      lifecycle.returnSale(
        terminal.terminalCode,
        secret,
        sale.id,
        {
          ...ret,
          requestId: randomUUID(),
          lines: [{ lineId: paidLine.id, quantity: 1, disposition: 'RESTOCK' }],
        },
        user,
      ),
    );
    assert.equal(await db.creditNote.count(), 2);
    assert.equal(await db.refund.count(), 2);
    assert.equal(
      Number(
        (
          await db.inventoryBalance.findFirst({
            where: { productId: product.id, branchId: branch.id },
          })
        ).quantityOnHand,
      ),
      unchangedStock,
    );
    await db.cashAccount.update({ where: { id: account.id }, data: { currentBalance: 1600 } });
    checks.push('Insufficient refund funds roll back credit, restock and transaction identity');
    // Real concurrent returns against the one remaining unit of the original credit sale.
    const creditLine = (await lifecycle.detail(terminal.terminalCode, secret, credit.id, user))
      .lines[0];
    const concurrent = await Promise.allSettled(
      [1, 2].map(() =>
        lifecycle.returnSale(
          terminal.terminalCode,
          secret,
          credit.id,
          {
            ...ret,
            requestId: randomUUID(),
            lines: [{ lineId: creditLine.id, quantity: 1, disposition: 'RESTOCK' }],
          },
          user,
        ),
      ),
    );
    assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      (await lifecycle.detail(terminal.terminalCode, secret, credit.id, user)).outstanding,
      0,
    );
    checks.push(
      'Concurrent different return identities cannot credit the same sold quantity twice',
    );
    // Tax and discount arithmetic must reverse the original cents after several returns.
    await db.product.update({ where: { id: product.id }, data: { isTaxable: true, taxRate: 18 } });
    const taxable = await sales.mobilePosLiteQuickSale(
      {
        ...scope,
        customerId: customer.id,
        salesType: 'CASH_SALE',
        orderDate: new Date().toISOString().slice(0, 10),
        paymentMethod: 'CASH',
        cashAccountId: account.id,
        currency: 'TZS',
        idempotencyKey: randomUUID(),
        lines: [
          {
            productId: product.id,
            quantity: 3,
            unitId: unit.id,
            unitPrice: 1200.01,
            discountAmount: 0.01,
          },
        ],
      },
      user,
      terminal.id,
      terminal.terminalCode,
    );
    const taxableDetail = await lifecycle.detail(terminal.terminalCode, secret, taxable.id, user);
    for (let i = 0; i < 3; i++)
      await lifecycle.returnSale(
        terminal.terminalCode,
        secret,
        taxable.id,
        {
          ...ret,
          requestId: randomUUID(),
          lines: [{ lineId: taxableDetail.lines[0].id, quantity: 1, disposition: 'RESTOCK' }],
        },
        user,
      );
    const taxableCredits = await db.creditNote.findMany({ where: { salesOrderId: taxable.id } });
    const sum = (key) => taxableCredits.reduce((n, c) => n + Math.round(Number(c[key]) * 100), 0);
    assert.equal(sum('totalAmount'), Math.round(Number(taxable.totalAmount) * 100));
    assert.equal(sum('taxAmount'), Math.round(Number(taxable.taxAmount) * 100));
    for (const j of await db.journalEntry.findMany({ include: { lines: true } }))
      assert.equal(
        j.lines.reduce((n, l) => n + Math.round(Number(l.debit) * 100), 0),
        j.lines.reduce((n, l) => n + Math.round(Number(l.credit) * 100), 0),
      );
    checks.push(
      'Taxable discounted partial returns reverse exact original gross and VAT cents with balanced journals',
    );
    const sampleCollection = await lifecycle.receipt(
      terminal.terminalCode,
      secret,
      collect.requestId,
      user,
    );
    const sampleReturn = await lifecycle.receipt(
      terminal.terminalCode,
      secret,
      ret.requestId,
      user,
    );
    const sampleSale = await pos.saleReceipt(terminal.terminalCode, secret, split.id, user);
    for (const receipt of [sampleCollection, sampleReturn, sampleSale]) {
      assert(receipt.buffer.subarray(0, 5).toString() === '%PDF-');
      assert(receipt.buffer.length > 1000);
    }
    await assert.rejects(
      lifecycle.receipt(terminal.terminalCode, secret, collect.requestId, restricted),
    );
    if (process.env.POS_PROOF_PDF_DIR) {
      const fs = require('node:fs');
      fs.writeFileSync(
        path.join(process.env.POS_PROOF_PDF_DIR, 'collection.pdf'),
        sampleCollection.buffer,
      );
      fs.writeFileSync(path.join(process.env.POS_PROOF_PDF_DIR, 'return.pdf'), sampleReturn.buffer);
      fs.writeFileSync(path.join(process.env.POS_PROOF_PDF_DIR, 'sale.pdf'), sampleSale.buffer);
    }
    checks.push(
      'Company-letterhead sale, collection and return PDFs render; revoked branch cannot download',
    );
    const daily = await pos.dailySummary(terminal.terminalCode, secret, undefined, user);
    const allocations = await db.paymentAllocation.findMany({
      where: { companyId: company.id, customerPayment: { status: 'COMPLETED', deletedAt: null } },
    });
    const refunds = await db.refund.findMany({ where: { companyId: company.id, status: 'PAID', deletedAt: null } });
    assert.equal(daily.collectionTotal, allocations.reduce((n, row) => n + Number(row.amount), 0));
    assert.equal(daily.refundTotal, refunds.reduce((n, row) => n + Number(row.amount), 0));
    assert.equal(daily.netReceipts, daily.initialReceipts + daily.collectionTotal - daily.refundTotal);
    await assert.rejects(pos.dailySummary(terminal.terminalCode, secret, undefined, restricted));
    const dailyPdf = await pos.dailySummaryPdf(terminal.terminalCode, secret, undefined, user);
    assert(dailyPdf.buffer.subarray(0, 5).toString() === '%PDF-');
    if (process.env.POS_PROOF_PDF_DIR) require('node:fs').writeFileSync(path.join(process.env.POS_PROOF_PDF_DIR, 'daily-report.pdf'), dailyPdf.buffer);
    checks.push('Native daily report reconciles real collections and paid refunds, renders letterhead PDF and rejects revoked scope');
    // Receiving and counting share canonical records, with replay-safe stock movements.
    const supplier = await db.supplier.create({ data: { ...scope, supplierCode: 'SUP-PROOF', name: 'Proof supplier' } });
    const beforeReceive = Number((await db.inventoryBalance.findFirst({ where: { productId: product.id, branchId: branch.id } })).quantityOnHand);
    const purchaseRequest = { supplierId: supplier.id, idempotencyKey: randomUUID(), lines: [{ productId: product.id, quantity: 2 }] };
    const purchase = await pos.createPurchase(terminal.terminalCode, secret, purchaseRequest, user);
    const purchaseReplay = await pos.createPurchase(terminal.terminalCode, secret, purchaseRequest, user);
    assert.equal(purchase.id, purchaseReplay.id);
    assert(purchase.grnNumber);
    assert.equal(Number((await db.inventoryBalance.findFirst({ where: { productId: product.id, branchId: branch.id } })).quantityOnHand), beforeReceive + 2);
    assert.equal(await db.purchaseOrder.count(), 1);
    assert.equal(await db.goodsReceivedNote.count(), 1);
    const deliveryHistory = await pos.purchaseHistory(terminal.terminalCode, secret, user);
    assert.equal(deliveryHistory.purchases[0].id, purchase.id);
    assert.equal(JSON.stringify(deliveryHistory).includes('unitCost'), false);
    checks.push('Native receiving creates one shared PO and posted GRN, increases stock once and exposes cost-blind history');
    const countRequest = { idempotencyKey: randomUUID(), countedAt: new Date().toISOString(), lines: [{ productId: product.id, countedQuantity: beforeReceive + 1 }] };
    const count = await pos.createStockCount(terminal.terminalCode, secret, countRequest, user);
    const countReplay = await pos.createStockCount(terminal.terminalCode, secret, countRequest, user);
    assert.equal(count.id, countReplay.id);
    assert.equal(count.status, 'POSTED');
    assert.equal(Number((await db.inventoryBalance.findFirst({ where: { productId: product.id, branchId: branch.id } })).quantityOnHand), beforeReceive + 1);
    const countHistory = await pos.stockCountHistory(terminal.terminalCode, secret, user);
    assert.equal(countHistory.counts[0].id, count.id);
    assert.equal(countHistory.counts[0].lines[0].varianceQuantity, -1);
    const countJournal = await db.journalEntry.findMany({ where: { referenceType: 'StockAdjustment', referenceId: count.id }, include: { lines: true } });
    assert.equal(countJournal.length, 1);
    assert.equal(countJournal[0].lines.reduce((n,l)=>n+Number(l.debit),0), countJournal[0].lines.reduce((n,l)=>n+Number(l.credit),0));
    checks.push('Native count posts one canonical adjustment and balanced journal, replays without another stock change and lists its original variance');
    console.log(JSON.stringify({ ok: true, compiled, unifiedCashBook, checks, existingBusinessDataChanged: false }));
  } finally {
    await db?.$disconnect();
    if (created) {
      assert(/^pos_selling_proof_[a-f0-9]{32}$/.test(name));
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await admin.$disconnect();
  }
}
main().catch((error) => {
  console.error('POS disposable proof failed: ' + error.message);
  const location = error.stack?.split('\n').find((line) => line.includes('verify-pos-payment-lifecycle.cjs:'));
  if (location) console.error(location.trim());
  process.exitCode = 1;
});
