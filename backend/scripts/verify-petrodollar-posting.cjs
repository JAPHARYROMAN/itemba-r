/* Real PostgreSQL/API proof. Creates only a named disposable local database.
 * --serve retains a fresh draft and API on 3017 for browser proof, until Ctrl+C.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '../tsconfig.json'),
});
require('reflect-metadata');
const { PrismaClient, Prisma } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { Reflector } = require('@nestjs/core');
const load = (file, name) => require(`../src/${file}`)[name];
const { ALL_PERMISSIONS } = require('../../database/seeds/permission-matrix');

async function main() {
  const configured = new URL(process.env.DATABASE_URL);
  assert(
    ['localhost', '127.0.0.1'].includes(configured.hostname),
    'Only local disposable PostgreSQL is supported.',
  );
  const name = `petrodollar_verify_${Date.now()}`;
  const url = new URL(configured);
  url.pathname = `/${name}`;
  const root = path.resolve(__dirname, '../..');
  const admin = new PrismaClient({ datasources: { db: { url: configured.toString() } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let app;
  const cleanup = async () => {
    await app?.close();
    await db.$disconnect();
    assert(/^petrodollar_verify_\d+$/.test(name));
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  };
  try {
    const push = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../node_modules/prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        path.join(root, 'database/prisma/schema.prisma'),
      ],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: url.toString() },
        encoding: 'utf8',
        timeout: 180000,
      },
    );
    assert.equal(push.status, 0, push.stderr || 'Disposable schema failed');
    // Rehearse the actual additive migration, not just the Prisma model.
    for (const table of ['sales_desk_sales', 'invoice_desk_invoices', 'cash_desk_movements'])
      await db.$executeRawUnsafe(`ALTER TABLE "${table}" DROP COLUMN "fuelReportPostingId"`);
    await db.$executeRawUnsafe('DROP TABLE fuel_report_postings');
    const migration = fs.readFileSync(
      path.join(
        root,
        'database/prisma/migrations/20261001220000_petrodollar_postings/migration.sql',
      ),
      'utf8',
    );
    for (const sql of migration.split(';').filter((s) => s.trim())) await db.$executeRawUnsafe(sql);
    const group = await db.group.create({ data: { code: 'PD-PROOF', name: 'Disposable proof' } });
    const company = await db.company.create({
      data: { groupId: group.id, code: 'MWANJALISI', name: 'Mwanjalisi Oil' },
    });
    const foreignCompany = await db.company.create({
      data: { groupId: group.id, code: 'FOREIGN', name: 'Other company' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, code: 'FUEL', name: 'Fuel', type: 'PETROLEUM' },
    });
    const branch = await db.branch.create({
      data: { divisionId: division.id, code: 'PROOF', name: 'Proof Station', type: 'FUEL_STATION' },
    });
    const secondBranch = await db.branch.create({
      data: { divisionId: division.id, code: 'OTHER', name: 'Other Station', type: 'FUEL_STATION' },
    });
    const user = await db.user.create({
      data: {
        email: 'petrodollar-proof@example.invalid',
        fullName: 'Station proof manager',
        passwordHash: 'DISPOSABLE',
        companyId: company.id,
      },
    });
    const manager = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      companyId: company.id,
      roles: ['BRANCH_MANAGER'],
      roleScopes: ['BRANCH'],
      permissions: ALL_PERMISSIONS.map((p) => p.code),
      companyAccess: [{ companyId: company.id, accessLevel: 'MANAGE' }],
      branchAccess: [{ branchId: branch.id, accessLevel: 'MANAGE' }],
    };
    const adminUser = { ...manager, roles: ['GROUP_SUPER_ADMIN'], roleScopes: ['GROUP'] };
    const category = await db.productCategory.create({
      data: { companyId: company.id, name: 'Fuel' },
    });
    const unit = await db.unitOfMeasure.create({ data: { name: 'Litre', symbol: 'L' } });
    const product = await db.product.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        baseUnitId: unit.id,
        name: 'Petrol',
        productCode: 'PETROL',
        defaultPurchasePrice: 2000,
      },
    });
    const retail = await db.customer.create({
      data: { companyId: company.id, customerCode: 'RETAIL', name: 'Retail fuel customers' },
    });
    const creditCustomer = await db.customer.create({
      data: { companyId: company.id, customerCode: 'CREDIT', name: 'Transport customer' },
    });
    const supplier = await db.supplier.create({
      data: { companyId: company.id, supplierCode: 'FUEL', name: 'Fuel supplier' },
    });
    const foreignCustomer = await db.customer.create({
      data: { companyId: foreignCompany.id, customerCode: 'BAD', name: 'Out of scope customer' },
    });
    await db.companyProfile.create({
      data: {
        companyId: company.id,
        registeredName: company.name,
        brelaRegNumber: 'PD-PROOF',
        tin: 'PD-PROOF',
        registeredAddress: 'Disposable fixture',
        currency: 'TZS',
      },
    });
    const year = await db.fiscalYear.create({
      data: {
        companyId: company.id,
        name: '2026',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
    const period = await db.accountingPeriod.create({
      data: {
        companyId: company.id,
        fiscalYearId: year.id,
        name: 'October',
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-31'),
      },
    });
    const ledger = {};
    for (const [key, type] of [
      ['receivable', 'ASSET'],
      ['revenue', 'INCOME'],
      ['payable', 'LIABILITY'],
      ['inventory', 'ASSET'],
      ['cost', 'COST_OF_GOODS_SOLD'],
      ['expense', 'EXPENSE'],
      ['variance', 'EXPENSE'],
      ['cash', 'ASSET'],
      ['mobile', 'ASSET'],
      ['bank', 'ASSET'],
    ])
      ledger[key] = await db.chartOfAccount.create({
        data: {
          companyId: company.id,
          accountCode: key.toUpperCase(),
          accountName: key,
          accountType: type,
        },
      });
    const cash = {};
    for (const key of ['cash', 'mobile', 'bank']) {
      const bank = await db.cashAccount.create({
        data: {
          companyId: company.id,
          divisionId: division.id,
          branchId: branch.id,
          accountName: key,
          currency: 'TZS',
          ledgerAccountId: ledger[key].id,
        },
      });
      cash[key] = await db.cashDeskAccount.create({
        data: {
          companyId: company.id,
          divisionId: division.id,
          branchId: branch.id,
          name: key,
          nameKey: key,
          kind: key === 'cash' ? 'CASH' : key === 'mobile' ? 'MOBILE_MONEY' : 'BANK',
          currency: 'TZS',
          openingDate: new Date('2026-10-01'),
          erpCashAccountId: bank.id,
        },
      });
    }
    await db.inventoryBalance.create({
      data: {
        companyId: company.id,
        divisionId: division.id,
        branchId: branch.id,
        productId: product.id,
        quantityOnHand: 1000,
        averageCost: 2000,
        totalValue: 2000000,
      },
    });
    const Companies = load('common/services/company-scope.service', 'CompanyScopeService');
    const Org = load('common/services/organization-scope.service', 'OrganizationScopeService');
    const Audit = load('modules/audit-logs/audit-logs.service', 'AuditLogsService');
    const Parties = load('common/services/desk-party-links.service', 'DeskPartyLinksService');
    const Fuel = load('modules/fuel-reporting/fuel-reporting.service', 'FuelReportingService');
    const Petro = load('modules/petrodollar/petrodollar.service', 'PetroDollarService');
    const Post = load(
      'modules/petrodollar/petrodollar-posting.service',
      'PetroDollarPostingService',
    );
    const Controller = load('modules/petrodollar/petrodollar.controller', 'PetroDollarController');
    const companies = new Companies(db),
      org = new Org(db),
      audit = new Audit(db),
      parties = new Parties(db, companies, org, audit);
    const engine = new (load(
      'modules/accounting-engine/posting-engine.service',
      'PostingEngineService',
    ))(
      db,
      new (load('common/services/accounting-control.service', 'AccountingControlService'))(db),
      new (load('common/services/account-resolver.service', 'AccountResolverService'))(db),
    );
    const invoices = new (load('modules/invoice-desk/invoice-desk.service', 'InvoiceDeskService'))(
      db,
      companies,
      org,
      audit,
      parties,
    );
    const connections = new (load(
      'modules/desk-reports/cash-connections.service',
      'CashConnectionsService',
    ))(db, companies, org, engine, audit);
    const cashService = new (load('modules/cash-desk/cash-desk.service', 'CashDeskService'))(
      db,
      companies,
      org,
      audit,
      invoices,
      connections,
    );
    const salesService = new (load('modules/sales-desk/sales-desk.service', 'SalesDeskService'))(
      db,
      companies,
      org,
      audit,
      cashService,
      parties,
    );
    const inventory = new (load(
      'modules/inventory-movements/inventory-movements.service',
      'InventoryMovementsService',
    ))(
      db,
      audit,
      new (load(
        'modules/entity-code-generator/entity-code-generator.service',
        'EntityCodeGeneratorService',
      ))(db),
      companies,
      new (load('modules/profit/profit.service', 'ProfitService'))(db, companies, audit),
    );
    const fuel = new Fuel(db, companies, audit),
      petro = new Petro(db, fuel);
    const posting = new Post(
      db,
      petro,
      companies,
      org,
      parties,
      cashService,
      connections,
      inventory,
      engine,
      audit,
    );
    const tank = await fuel.createTank(adminUser, {
      branchId: branch.id,
      productId: product.id,
      code: 'T1',
      name: 'Petrol tank',
      capacityLitres: 5000,
    });
    const pump = await fuel.createPump(adminUser, {
      branchId: branch.id,
      code: 'P1',
      name: 'Pump 1',
      nozzles: [{ code: 'N1', tankId: tank.id }],
    });
    const nozzle = await db.fuelNozzle.findFirstOrThrow({ where: { pumpId: pump.id } });
    const payload = {
      readings: [
        {
          nozzleId: nozzle.id,
          attendantName: 'Station attendant',
          opening: 1000,
          closing: 1100,
          price: 3000,
        },
      ],
      dips: [{ tankId: tank.id, opening: 1000, closing: 999 }],
      deliveries: [
        {
          productId: product.id,
          litres: 100,
          supplier: supplier.name,
          reference: 'FUEL-INV-001',
          totalCost: 220000,
          paidAmount: 100000,
          paymentSource: 'SHIFT_CASH',
        },
      ],
      expenses: [
        {
          category: 'Transport',
          description: 'Fuel delivery handling',
          amount: 10000,
          paymentSource: 'SHIFT_CASH',
        },
      ],
      creditSales: [{ customer: creditCustomer.name, reference: 'TR-001', amount: 50000 }],
      collections: {
        cash: 200000,
        mobile: 30000,
        bank: 20000,
        openingCash: 0,
        cashHandedOver: 90000,
      },
      receiptsConfirmed: true,
      expensesConfirmed: true,
      notes: 'Disposable workflow proof',
      discrepancyReason: 'One litre dip variance confirmed',
      documentIds: [],
    };
    const day = '2026-10-01';
    const dto = { branchId: branch.id, businessDate: day, shift: 'DAY', version: 0, payload };
    const module = await Test.createTestingModule({
      imports: [
        load('modules/accounting-engine/accounting-engine.module', 'AccountingEngineModule'),
        load(
          'modules/entity-code-generator/entity-code-generator.module',
          'EntityCodeGeneratorModule',
        ),
        load('modules/petrodollar/petrodollar.module', 'PetroDollarModule'),
        load('modules/sales-desk/sales-desk.module', 'SalesDeskModule'),
      ],
    })
      .overrideProvider(load('prisma/prisma.service', 'PrismaService'))
      .useValue(db)
      .compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    const users = {
      'fixture-manager': manager,
      'fixture-admin': adminUser,
      'fixture-no-post': { ...manager, permissions: ['fuel_reporting.read'] },
      'fixture-read-only': {
        ...manager,
        companyAccess: [{ companyId: company.id, accessLevel: 'READ' }],
        divisionAccess: [{ divisionId: division.id, accessLevel: 'READ' }],
        branchAccess: [{ branchId: branch.id, accessLevel: 'READ' }],
      },
      'fixture-other-branch': {
        ...manager,
        branchAccess: [{ branchId: secondBranch.id, accessLevel: 'WRITE' }],
      },
    };
    app.use((req, res, next) => {
      req.user = users[(req.headers.authorization || '').replace('Bearer ', '')];
      // Synthetic session only on the loopback, disposable proof server.
      if (req.path === '/api/v1/auth/me')
        return req.user
          ? res.json({ data: req.user })
          : res.status(401).json({ message: 'Proof session required' });
      if (req.path === '/api/v1/auth/refresh')
        return req.user
          ? res.json({ data: { accessToken: 'fixture-manager', refreshToken: 'fixture-manager' } })
          : res.status(401).json({ message: 'Proof session required' });
      next();
    });
    app.useGlobalGuards(
      new (load('common/guards/permissions.guard', 'PermissionsGuard'))(new Reflector(), audit),
    );
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(process.argv.includes('--serve') ? 3017 : 0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    const api = async (route, body, token = 'fixture-manager') => {
      const res = await fetch(`${baseUrl}/petrodollar/${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() };
    };
    const check = async (route, body, status = 201, token) => {
      const r = await api(route, body, token);
      assert.equal(r.status, status, JSON.stringify(r.body));
      return r.body;
    };
    // The OS app owns station administration too, using the same master records.
    await check('stations', null, 403);
    const station = await check(
      'stations',
      {
        divisionId: division.id,
        code: 'OS-ADMIN',
        name: 'OS Admin Station',
        location: 'Proof only',
      },
      201,
      'fixture-admin',
    );
    const stationTank = await check(
      'tanks',
      {
        branchId: station.id,
        productId: product.id,
        code: 'OS-TANK',
        name: 'OS Tank',
        capacityLitres: 5000,
      },
      201,
      'fixture-admin',
    );
    const stationPump = await check(
      'pumps',
      {
        branchId: station.id,
        code: 'OS-PUMP',
        name: 'OS Pump',
        nozzles: [{ code: 'OS-N1', tankId: stationTank.id }],
      },
      201,
      'fixture-admin',
    );
    await check(
      `stations/${station.id}/update`,
      { code: 'OS-ADMIN', name: 'OS Station Updated', location: 'Proof only' },
      201,
      'fixture-admin',
    );
    await check(`pumps/${stationPump.id}/deactivate`, {}, 201, 'fixture-admin');
    await check(`stations/${station.id}/deactivate`, {}, 201, 'fixture-admin');
    const removedRegister = await check('stations', null, 200, 'fixture-admin');
    assert.equal(removedRegister.stations.find((row) => row.id === station.id).isActive, false);
    await check(`stations/${station.id}/restore`, {}, 201, 'fixture-admin');
    const foreignDivision = await db.division.create({
      data: { companyId: foreignCompany.id, code: 'FUEL', name: 'Foreign fuel', type: 'PETROLEUM' },
    });
    await check(
      'stations',
      { divisionId: foreignDivision.id, code: 'FORBIDDEN', name: 'Foreign station', location: '' },
      404,
      'fixture-admin',
    );
    const scopedRegister = await check('stations', null, 200, 'fixture-admin');
    assert(scopedRegister.divisions.every((row) => row.companyId === company.id));
    assert.equal(await db.branch.count({ where: { divisionId: foreignDivision.id } }), 0);
    const draft = await check('reports', dto);
    assert.equal(await db.cashDeskMovement.count(), 0, 'A draft cannot create cash');
    assert.equal(await db.inventoryMovement.count(), 0, 'A draft cannot move stock');
    const closed = await check('reports', { ...dto, version: draft.version, close: true });
    assert.equal(closed.summary.sales, 300000);
    assert.equal(closed.summary.stock[0].difference, -1);
    assert.equal(await db.journalEntry.count(), 0, 'Closing a paper shift alone cannot post');
    const review = await check(`reports/${closed.id}/posting`, null, 200);
    assert.equal(review.issues.length, 0);
    assert.equal(review.canPost, true);
    const selections = {
      retailCustomerId: retail.id,
      cashAccountId: cash.cash.id,
      mobileAccountId: cash.mobile.id,
      bankAccountId: cash.bank.id,
      ...Object.fromEntries(
        ['receivable', 'revenue', 'payable', 'inventory', 'cost', 'expense', 'variance'].map(
          (k) => [`${k}AccountId`, ledger[k].id],
        ),
      ),
      credits: [{ customerId: creditCustomer.id, dueDate: day }],
      deliveries: [{ supplierId: supplier.id, dueDate: day, accountId: cash.cash.id }],
      expenses: [{ accountId: cash.cash.id }],
    };
    const request = {
      requestId: randomUUID(),
      version: closed.version,
      fingerprint: review.fingerprint,
      selections,
    };
    await db.inventoryBalance.updateMany({
      where: { branchId: branch.id },
      data: { quantityOnHand: 999 },
    });
    await check(`reports/${closed.id}/posting`, { ...request, requestId: randomUUID() }, 409);
    await db.inventoryBalance.updateMany({
      where: { branchId: branch.id },
      data: { quantityOnHand: 1000 },
    });
    await check(`reports/${closed.id}/posting`, request, 403, 'fixture-no-post');
    await check(`reports/${closed.id}/posting`, request, 403, 'fixture-other-branch');
    await check(
      `reports/${closed.id}/posting`,
      { ...request, requestId: randomUUID(), version: closed.version - 1 },
      409,
    );
    await check(
      `reports/${closed.id}/posting`,
      {
        ...request,
        requestId: randomUUID(),
        selections: { ...selections, retailCustomerId: foreignCustomer.id },
      },
      400,
    );
    assert.equal(await db.fuelReportPosting.count(), 0);
    assert.equal(await db.salesDeskSale.count(), 0);
    await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'CLOSED' } });
    await check(`reports/${closed.id}/posting`, { ...request, requestId: randomUUID() }, 400);
    await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
    assert.equal(await db.cashDeskMovement.count(), 0, 'Period failure rolls back cash');
    assert.equal(await db.inventoryMovement.count(), 0, 'Period failure rolls back stock');
    // Posting captures this historical hold before canonical movement expiry
    // releases it. Reversal must restore stock value without resurrecting it.
    const expiredHold = await db.posDraft.create({
      data: {
        companyId: company.id,
        divisionId: division.id,
        branchId: branch.id,
        originUserId: user.id,
        originRole: 'CASHIER',
        requestId: randomUUID(),
        kind: 'SALE',
        status: 'AWAITING_STOCKIST',
        businessDate: new Date(day),
        capturedAt: new Date(),
        payload: { lines: [{ productId: product.id, quantity: 5 }] },
        amount: 100,
        pendingMoney: 100,
        reservedUntil: new Date(Date.now() - 60_000),
        reservations: {
          create: {
            companyId: company.id,
            branchId: branch.id,
            productId: product.id,
            quantity: 5,
            expiresAt: new Date(Date.now() - 60_000),
          },
        },
      },
      include: { reservations: true },
    });
    await db.inventoryBalance.updateMany({
      where: { branchId: branch.id, productId: product.id },
      data: { quantityReserved: 5 },
    });
    const races = await Promise.all([
      api(`reports/${closed.id}/posting`, request),
      api(`reports/${closed.id}/posting`, request),
    ]);
    for (const r of races) assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(races[0].body.id, races[1].body.id, 'Uncertain retries recover the same posting');
    const posted = races[0].body;
    const reordered = (value) =>
      Array.isArray(value)
        ? value.map(reordered)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, item]) => [key, reordered(item)]),
            )
          : value;
    const recovered = await check(`reports/${closed.id}/posting`, reordered(request));
    assert.equal(recovered.id, posted.id, 'Equivalent nested JSON recovers the original posting');
    await check(
      `reports/${closed.id}/posting`,
      { ...request, selections: { ...selections, retailCustomerId: creditCustomer.id } },
      409,
    );
    await db.company.update({ where: { id: company.id }, data: { status: 'SUSPENDED' } });
    await check(`reports/${closed.id}/posting`, request, 403);
    await db.company.update({ where: { id: company.id }, data: { status: 'ACTIVE' } });
    assert.equal(await db.fuelReportPosting.count(), 1);
    assert.equal(await db.salesDeskSale.count(), 2);
    assert.equal(await db.invoiceDeskInvoice.count(), 1);
    await check(
      `reports/${closed.id}/posting/reverse`,
      { postingId: posted.id, reason: 'Forbidden read-only correction' },
      403,
      'fixture-read-only',
    );
    await check(`reports/${closed.id}/posting`, { ...request, requestId: randomUUID() }, 409);
    assert.equal(
      (await db.cashDeskAccount.findUnique({ where: { id: cash.cash.id } })).balance.toFixed(2),
      '90000.00',
    );
    assert.equal(
      (await db.cashDeskAccount.findUnique({ where: { id: cash.mobile.id } })).balance.toFixed(2),
      '30000.00',
    );
    const balance = await db.inventoryBalance.findFirstOrThrow({
      where: { branchId: branch.id, productId: product.id },
    });
    assert.equal(balance.quantityOnHand.toString(), '999');
    assert.equal(balance.quantityReserved.toNumber(), 0);
    assert.ok(
      (
        await db.posDraftReservation.findUniqueOrThrow({
          where: { id: expiredHold.reservations[0].id },
        })
      ).releasedAt,
    );
    assert.equal(
      posted.evidence.beforeStock.find((row) => row.productId === product.id).reserved,
      '5',
    );
    const saleRows = await salesService.list(manager, { companyId: company.id, page: 1 });
    assert.equal(saleRows.total, 2);
    const invoiceRows = await invoices.list(manager, { companyId: company.id, page: 1 });
    assert.equal(invoiceRows.rows[0].outstanding, '120000.00');
    const creditSale = await db.salesDeskSale.findFirstOrThrow({ where: { paidAmount: 0 } });
    assert.equal(creditSale.totalAmount.toString(), '50000');
    const totals = await db.journalEntryLine.groupBy({
      by: ['accountId'],
      where: { journalEntry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    const net = (key) => {
      const row = totals.find((r) => r.accountId === ledger[key].id);
      return new Prisma.Decimal(row?._sum.debit ?? 0).minus(row?._sum.credit ?? 0).toFixed(2);
    };
    assert.equal(net('receivable'), '50000.00');
    assert.equal(net('payable'), '-120000.00');
    assert.equal(net('revenue'), '-300000.00');
    assert.equal(
      new Prisma.Decimal('2000000').plus(net('inventory')).toFixed(2),
      balance.totalValue.toFixed(2),
      'Inventory and journal valuation agree',
    );
    assert.equal(net('cash'), '90000.00');
    for (const account of Object.values(cash)) {
      const pair = await db.cashDeskAccount.findUniqueOrThrow({
        where: { id: account.id },
        include: { erpCashAccount: true },
      });
      assert.equal(
        pair.erpCashAccount.currentBalance.toFixed(2),
        pair.balance.toFixed(2),
        'Shift cash affects both connected balances once',
      );
    }
    assert.equal(net('expense'), '10000.00');
    await check(
      `reports/${closed.id}/reopen`,
      { version: closed.version, reason: 'Correction' },
      409,
    );
    await assert.rejects(
      () =>
        salesService.void(manager, creditSale.id, {
          version: creditSale.version,
          reason: 'Invalid direct void',
        }),
      /PetroDollar/,
    );
    await assert.rejects(
      () =>
        cashService.reverse(manager, posted.evidence.movementIds[0], {
          requestId: randomUUID(),
          businessDate: day,
          reason: 'Invalid direct reversal',
        }),
      /PetroDollar/,
    );
    // A partial downstream collection is supported, and blocks reversal of the source shift.
    const later = await salesService.payment(manager, creditSale.id, {
      requestId: randomUUID(),
      version: creditSale.version,
      amount: '10000',
      paymentDate: day,
      reference: 'Later collection',
      accountId: cash.cash.id,
    });
    await check(
      `reports/${closed.id}/posting/reverse`,
      { postingId: posted.id, reason: 'Correction' },
      409,
    );
    const laterMovement = await db.cashDeskMovement.findUniqueOrThrow({
      where: { salesPaymentId: later.id },
    });
    await cashService.reverse(manager, laterMovement.id, {
      requestId: randomUUID(),
      businessDate: day,
      reason: 'Undo proof collection',
    });
    // Supplier settlements use the shared invoice balance and block source corrections too.
    const supplierInvoice = await db.invoiceDeskInvoice.findUniqueOrThrow({
      where: { id: posted.evidence.invoiceIds[0] },
    });
    const settlement = await cashService.record(manager, {
      requestId: randomUUID(),
      kind: 'SUPPLIER_PAYMENT',
      accountId: cash.cash.id,
      invoiceId: supplierInvoice.id,
      invoiceVersion: supplierInvoice.version,
      amount: '10000',
      businessDate: day,
      description: 'Later fuel supplier settlement',
      reference: 'SUP-PART-001',
    });
    assert.equal(
      (
        await db.invoiceDeskInvoice.findUniqueOrThrow({ where: { id: supplierInvoice.id } })
      ).paidAmount.toFixed(2),
      '110000.00',
    );
    await check(
      `reports/${closed.id}/posting/reverse`,
      { postingId: posted.id, reason: 'Correction after supplier settlement' },
      409,
    );
    await cashService.reverse(manager, settlement.id, {
      requestId: randomUUID(),
      businessDate: day,
      reason: 'Undo proof supplier settlement',
    });
    // Later reservations/stock activity block an unsafe WAC restore.
    await db.inventoryBalance.update({ where: { id: balance.id }, data: { quantityReserved: 1 } });
    await check(
      `reports/${closed.id}/posting/reverse`,
      { postingId: posted.id, reason: 'Correction' },
      409,
    );
    await db.inventoryBalance.update({ where: { id: balance.id }, data: { quantityReserved: 0 } });
    const reversed = await check(`reports/${closed.id}/posting/reverse`, {
      postingId: posted.id,
      reason: 'Correct paper reading',
    });
    assert(reversed.reversedAt);
    for (const account of Object.values(cash)) {
      const pair = await db.cashDeskAccount.findUniqueOrThrow({
        where: { id: account.id },
        include: { erpCashAccount: true },
      });
      assert.equal(
        pair.erpCashAccount.currentBalance.toFixed(2),
        '0.00',
        'Whole-shift reversal restores ERP cash',
      );
      assert.equal(pair.balance.toFixed(2), '0.00', 'Whole-shift reversal restores desk cash');
    }
    assert.equal(
      (await db.cashDeskAccount.findUnique({ where: { id: cash.cash.id } })).balance.toFixed(2),
      '0.00',
    );
    const restored = await db.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } });
    assert.equal(restored.quantityOnHand.toString(), '1000');
    assert.equal(restored.averageCost.toString(), '2000');
    assert.equal(restored.totalValue.toString(), '2000000');
    assert.equal(
      restored.quantityReserved.toNumber(),
      0,
      'Reversal cannot recreate an expired, unowned hold',
    );
    assert.ok(
      restored.physicalRevision > balance.physicalRevision,
      'Out-and-back stock still invalidates earlier physical counts',
    );
    const journalNet = await db.journalEntryLine.aggregate({ _sum: { debit: true, credit: true } });
    assert(journalNet._sum.debit.eq(journalNet._sum.credit));
    const zeroed = await db.journalEntryLine.groupBy({
      by: ['accountId'],
      where: { journalEntry: { status: { in: ['POSTED', 'REVERSED'] }, deletedAt: null } },
      _sum: { debit: true, credit: true },
    });
    for (const account of zeroed)
      assert(
        account._sum.debit.eq(account._sum.credit),
        'Each ledger account nets to zero after whole-shift reversal',
      );
    for (const movementId of posted.evidence.movementIds) {
      const reversedMovement = await db.cashDeskMovement.findUniqueOrThrow({
        where: { reversalOfId: movementId },
      });
      assert.equal(
        await db.journalEntry.count({
          where: { referenceType: 'DeskCash', referenceId: reversedMovement.id, status: 'POSTED' },
        }),
        1,
        'Every compensating cash movement has its own linked journal',
      );
    }
    const reopened = await check(`reports/${closed.id}/reopen`, {
      version: closed.version,
      reason: 'Correct paper reading',
    });
    // A supplier value that cannot be expressed exactly as a four-decimal unit price still reconciles.
    const correctedPayload = {
      ...payload,
      deliveries: [{ ...payload.deliveries[0], totalCost: 220000.01 }],
    };
    const reclosed = await check('reports', {
      ...dto,
      payload: correctedPayload,
      version: reopened.version,
      close: true,
    });
    const rereview = await check(`reports/${closed.id}/posting`, null, 200);
    const reposted = await check(`reports/${closed.id}/posting`, {
      ...request,
      requestId: randomUUID(),
      version: reclosed.version,
      fingerprint: rereview.fingerprint,
    });
    assert.notEqual(
      reposted.id,
      posted.id,
      'Correction gets a new linked revision, without replacing history',
    );
    await check(`reports/${closed.id}/posting/reverse`, {
      postingId: reposted.id,
      reason: 'Reset browser proof',
    });
    const fresh = await check(`reports/${closed.id}/reopen`, {
      version: reclosed.version,
      reason: 'Browser entry proof',
    });
    const fixture = {
      baseUrl,
      manager,
      branchId: branch.id,
      reportId: fresh.id,
      productId: product.id,
      selections,
      day,
      payload,
    };
    fs.mkdirSync(path.join(root, '.tmp-petrodollar'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.tmp-petrodollar/fixture.json'),
      JSON.stringify(fixture, null, 2),
    );
    fs.writeFileSync(
      path.join(root, '.tmp-petrodollar/api-proof.json'),
      JSON.stringify(
        {
          passed: true,
          checks: [
            'OS station administration, role enforcement and company isolation',
            'additive migration',
            'draft and close do not post',
            'scope and permission enforcement',
            'stale revision',
            'foreign customer',
            'period-lock rollback',
            'concurrent retries',
            'sales and supplier balances',
            'cash and stock/journal agreement',
            'partial collection',
            'downstream activity blocks reversal',
            'exact WAC restore',
            'correction and repost',
          ],
          observedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: PetroDollar station-day posting, balances, idempotency, permissions, rollback, reversal and correction.',
    );
    if (process.argv.includes('--serve')) {
      console.log('Disposable browser fixture listening on 127.0.0.1:3017');
      await new Promise((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
    }
  } finally {
    await cleanup();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
