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
        'sales.create',
        'sales.view',
        'cash_desk.view',
        'cash_accounts.view',
        'receivables.view',
        'customer-payments.view',
        'inventory.view',
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
    const pos = new Mobile(
      db,
      companies,
      audit,
      sales,
      null,
      null,
      codes,
      null,
      null,
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
    console.log(JSON.stringify({ ok: true, compiled, checks, existingBusinessDataChanged: false }));
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
  process.exitCode = 1;
});
