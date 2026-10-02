/* Equipment lifecycle proof against a generated, disposable LOCAL PostgreSQL database.
 * --serve keeps synthetic fixtures and the loopback API on 3021 for browser verification.
 * Never reads or changes application, staging or production business records.
 */
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '../tsconfig.json'),
});
require('reflect-metadata');
const { PrismaClient } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { Reflector } = require('@nestjs/core');
const load = (file, name) => require(`../src/${file}`)[name];
const FuelReportingService = load(
  'modules/fuel-reporting/fuel-reporting.service',
  'FuelReportingService',
);
const FuelReportingController = load(
  'modules/fuel-reporting/fuel-reporting.controller',
  'FuelReportingController',
);
const PetroDollarService = load('modules/petrodollar/petrodollar.service', 'PetroDollarService');
const PetroDollarController = load(
  'modules/petrodollar/petrodollar.controller',
  'PetroDollarController',
);
const PetroDollarPostingService = load(
  'modules/petrodollar/petrodollar-posting.service',
  'PetroDollarPostingService',
);
const CompanyScopeService = load('common/services/company-scope.service', 'CompanyScopeService');
const AuditLogsService = load('modules/audit-logs/audit-logs.service', 'AuditLogsService');
const PermissionsGuard = load('common/guards/permissions.guard', 'PermissionsGuard');
const PurchaseOrdersService = load(
  'modules/purchase-orders/purchase-orders.service',
  'PurchaseOrdersService',
);

async function main() {
  const configured = new URL(process.env.DATABASE_URL);
  assert(
    ['localhost', '127.0.0.1'].includes(configured.hostname),
    'Verification requires local PostgreSQL.',
  );
  const name = `fuel_equipment_verify_${Date.now()}`;
  assert(/^fuel_equipment_verify_\d+$/.test(name));
  const url = new URL(configured);
  url.pathname = `/${name}`;
  const root = path.resolve(__dirname, '../..');
  const adminDb = new PrismaClient({ datasources: { db: { url: configured.toString() } } });
  await adminDb.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let app;
  try {
    const pushed = spawnSync(
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
        windowsHide: true,
      },
    );
    assert.equal(pushed.status, 0, 'Could not initialise the disposable schema.');
    const group = await db.group.create({
      data: { code: 'EQUIPMENT-PROOF', name: 'Disposable equipment verification' },
    });
    const company = await db.company.create({
      data: { groupId: group.id, code: 'MWANJALISI', name: 'Mwanjalisi fixture' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, code: 'FUEL', name: 'Fuel', type: 'PETROLEUM' },
    });
    const branch = await db.branch.create({
      data: {
        divisionId: division.id,
        code: 'VERIFY',
        name: 'Verification Station',
        type: 'FUEL_STATION',
      },
    });
    const otherCompany = await db.company.create({
      data: { groupId: group.id, code: 'OTHER', name: 'Other fixture company' },
    });
    const otherDivision = await db.division.create({
      data: { companyId: otherCompany.id, code: 'OTHER', name: 'Other', type: 'PETROLEUM' },
    });
    const otherBranch = await db.branch.create({
      data: {
        divisionId: otherDivision.id,
        code: 'OTHER',
        name: 'Other Station',
        type: 'FUEL_STATION',
      },
    });
    const user = await db.user.create({
      data: {
        email: 'fuel-equipment@example.invalid',
        fullName: 'Verification administrator',
        passwordHash: 'DISPOSABLE',
        companyId: company.id,
      },
    });
    const administrator = {
      id: user.id,
      companyId: company.id,
      fullName: user.fullName,
      email: user.email,
      roles: ['GROUP_SUPER_ADMIN'],
      roleScopes: ['GROUP'],
      permissions: ['fuel_reporting.read', 'fuel_reporting.manage', 'fuel_reporting.admin'],
      companyAccess: [{ companyId: company.id, accessLevel: 'MANAGE' }],
    };
    const manager = {
      ...administrator,
      roles: ['BRANCH_MANAGER'],
      roleScopes: ['BRANCH'],
      permissions: ['fuel_reporting.read', 'fuel_reporting.manage'],
      branchAccess: [{ branchId: branch.id, accessLevel: 'WRITE' }],
    };
    const readOnly = {
      ...administrator,
      companyId: undefined,
      companyAccess: [{ companyId: company.id, accessLevel: 'READ' }],
    };
    const category = await db.productCategory.create({
      data: { companyId: company.id, name: 'Fuel' },
    });
    const unit = await db.unitOfMeasure.create({ data: { name: 'Litre', symbol: 'L' } });
    const product = await db.product.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        baseUnitId: unit.id,
        name: 'Diesel (AGO)',
        productCode: 'AGO',
      },
    });
    const scope = new CompanyScopeService(db);
    const audit = new AuditLogsService(db);
    const fuel = new FuelReportingService(db, scope, audit);
    const petro = new PetroDollarService(db, fuel);
    const createTank = (code, station = branch) =>
      fuel.createTank(administrator, {
        branchId: station.id,
        code,
        name: code === 'SPARE' ? 'Spare diesel tank' : `${code} tank`,
        productId: product.id,
        capacityLitres: 52000,
      });
    const tank = await createTank('AGO-1');
    const spare = await createTank('SPARE');
    const wet = await createTank('BALANCE');
    const pump = await fuel.createPump(administrator, {
      branchId: branch.id,
      code: 'P1',
      name: 'Main pump',
      nozzles: [
        { code: 'N1', tankId: tank.id },
        { code: 'N2', tankId: tank.id },
      ],
    });
    const nozzles = await db.fuelNozzle.findMany({
      where: { pumpId: pump.id },
      orderBy: { nozzleCode: 'asc' },
    });
    await db.fuelNozzle.update({
      where: { id: nozzles[0].id },
      data: { currentMeterReading: 12500 },
    });
    const foreignTank = await db.fuelTank.create({
      data: {
        companyId: otherCompany.id,
        divisionId: otherDivision.id,
        branchId: otherBranch.id,
        productId: product.id,
        tankCode: 'FOREIGN',
        tankName: 'Foreign tank',
        capacityLitres: 1000,
      },
    });
    const module = await Test.createTestingModule({
      controllers: [FuelReportingController, PetroDollarController],
      providers: [
        { provide: FuelReportingService, useValue: fuel },
        { provide: PetroDollarService, useValue: petro },
        { provide: PetroDollarPostingService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.use((req, res, next) => {
      req.user = {
        'Bearer fixture-admin': administrator,
        'Bearer fixture-manager': manager,
        'Bearer fixture-read-only': readOnly,
      }[req.headers.authorization];
      next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector(), audit));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(process.argv.includes('--serve') ? 3021 : 0, '127.0.0.1');
    const port = app.getHttpServer().address().port;
    async function api(method, route, body, token = 'fixture-admin') {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    async function checked(method, route, body, status = 200, token) {
      const result = await api(method, route, body, token);
      assert.equal(result.status, status, `${method} ${route}: ${JSON.stringify(result.body)}`);
      return result.body;
    }
    const revision = (record) => ({
      expectedUpdatedAt:
        record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
    });
    const tankDetails = (record, tankName = record.tankName) => ({
      ...revision(record),
      code: record.tankCode,
      name: tankName,
      productId: record.productId,
      capacityLitres: Number(record.capacityLitres),
    });
    const workspaceRoute = `petrodollar/workspace?branchId=${branch.id}&businessDate=2026-10-02&shift=DAY`;
    await checked('DELETE', `petrodollar/tanks/${spare.id}`, revision(spare), 401, '');
    await checked(
      'DELETE',
      `petrodollar/tanks/${spare.id}`,
      revision(spare),
      403,
      'fixture-manager',
    );
    await checked(
      'DELETE',
      `petrodollar/tanks/${spare.id}`,
      revision(spare),
      403,
      'fixture-read-only',
    );
    await checked('DELETE', `petrodollar/tanks/${foreignTank.id}`, revision(foreignTank), 404);
    await checked('DELETE', `petrodollar/tanks/${spare.id}`, {}, 400);
    await checked('DELETE', 'petrodollar/tanks/not-a-uuid', revision(spare), 400);
    await checked(
      'PATCH',
      `petrodollar/tanks/${spare.id}`,
      { ...tankDetails(spare), capacityLitres: 0 },
      400,
    );
    assert.equal(
      (await checked('GET', workspaceRoute, null, 200, 'fixture-read-only')).canConfigure,
      false,
    );
    const payload = {
      readings: nozzles.map((n) => ({
        nozzleId: n.id,
        attendantName: 'Verification attendant',
        opening: 0,
        closing: 0,
        price: 2800,
      })),
      dips: [tank, spare, wet].map((t) => ({
        tankId: t.id,
        opening: t.id === wet.id ? 100 : 0,
        closing: t.id === wet.id ? 100 : 0,
      })),
      deliveries: [],
      expenses: [],
      creditSales: [],
      collections: { cash: 0, mobile: 0, bank: 0, openingCash: 0, cashHandedOver: 0 },
      receiptsConfirmed: true,
      expensesConfirmed: true,
      notes: 'Disposable report fixture',
      discrepancyReason: '',
      documentIds: [],
    };
    const draft = await checked(
      'POST',
      'petrodollar/reports',
      { branchId: branch.id, businessDate: '2026-10-01', shift: 'DAY', version: 0, payload },
      201,
    );
    await checked('DELETE', `petrodollar/tanks/${spare.id}`, revision(spare), 409);
    const report = await checked(
      'POST',
      'petrodollar/reports',
      {
        branchId: branch.id,
        businessDate: '2026-10-01',
        shift: 'DAY',
        version: draft.version,
        close: true,
        payload,
      },
      201,
    );
    const historical = JSON.stringify(
      await db.fuelReport.findUniqueOrThrow({ where: { id: report.id } }),
    );
    const historicalRevisions = JSON.stringify(
      await db.fuelReportRevision.findMany({
        where: { reportId: report.id },
        orderBy: { version: 'asc' },
      }),
    );
    await checked('DELETE', `petrodollar/tanks/${tank.id}`, revision(tank), 409);
    await checked('DELETE', `petrodollar/tanks/${wet.id}`, revision(wet), 409);
    const renamed = await checked(
      'PATCH',
      `petrodollar/tanks/${spare.id}`,
      tankDetails(spare, 'Spare diesel tank updated'),
    );
    await checked('DELETE', `petrodollar/tanks/${spare.id}`, revision(spare), 409);
    const deleted = await checked('DELETE', `petrodollar/tanks/${spare.id}`, revision(renamed));
    assert.equal(deleted.id, spare.id);
    assert(deleted.deletedAt);
    let workspace = await checked('GET', workspaceRoute);
    assert(!workspace.catalog.tanks.some((t) => t.id === spare.id));
    assert(workspace.tanks.some((t) => t.id === spare.id && t.deletedAt));
    const restored = await checked(
      'POST',
      `petrodollar/tanks/${spare.id}/restore`,
      revision(deleted),
      201,
    );
    assert.equal(restored.id, spare.id);
    workspace = await checked('GET', workspaceRoute);
    assert(workspace.catalog.tanks.some((t) => t.id === spare.id));
    assert.equal(
      JSON.stringify(await db.fuelReport.findUniqueOrThrow({ where: { id: report.id } })),
      historical,
    );
    assert.equal(
      JSON.stringify(
        await db.fuelReportRevision.findMany({
          where: { reportId: report.id },
          orderBy: { version: 'asc' },
        }),
      ),
      historicalRevisions,
    );
    const pumpEdit = {
      ...revision(pump),
      code: 'P1',
      name: 'Edited pump',
      nozzles: [
        { id: nozzles[0].id, code: 'N1', tankId: tank.id },
        { code: 'N3', tankId: tank.id },
      ],
    };
    const outcomes = await Promise.all([
      api('PATCH', `petrodollar/pumps/${pump.id}`, pumpEdit),
      api('PATCH', `petrodollar/pumps/${pump.id}`, { ...pumpEdit, name: 'Other window' }),
    ]);
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
    const editedPump = outcomes.find((r) => r.status === 200).body;
    const retained = await db.fuelNozzle.findUniqueOrThrow({ where: { id: nozzles[0].id } });
    assert.equal(Number(retained.currentMeterReading), 12500);
    assert((await db.fuelNozzle.findUniqueOrThrow({ where: { id: nozzles[1].id } })).deletedAt);
    const removedPump = await checked(
      'DELETE',
      `fuel-reporting/pumps/${pump.id}`,
      revision(editedPump),
    );
    const restoredPump = await checked(
      'POST',
      `petrodollar/pumps/${pump.id}/restore`,
      revision(removedPump),
      201,
    );
    assert.equal(restoredPump.status, 'ACTIVE');
    assert.equal(
      await db.fuelNozzle.count({ where: { pumpId: pump.id, deletedAt: null, status: 'ACTIVE' } }),
      2,
    );
    assert((await db.fuelNozzle.findUniqueOrThrow({ where: { id: nozzles[1].id } })).deletedAt);
    const rollbackTank = await createTank('ROLLBACK');
    const failAudit = new FuelReportingService(db, scope, {
      logStrictInTransaction: async () => {
        throw new Error('Simulated audit failure');
      },
    });
    await assert.rejects(
      () => failAudit.deleteTank(administrator, rollbackTank.id, revision(rollbackTank)),
      /audit failure/,
    );
    assert.equal(
      (await db.fuelTank.findUniqueOrThrow({ where: { id: rollbackTank.id } })).deletedAt,
      null,
    );
    const raceTank = await createTank('RECEIPT-RACE');
    let entered, release;
    const prepared = new Promise((resolve) => {
      entered = resolve;
    });
    const proceed = new Promise((resolve) => {
      release = resolve;
    });
    const delayedAudit = new FuelReportingService(db, scope, {
      logStrictInTransaction: async (tx, data) => {
        entered();
        await proceed;
        await audit.logStrictInTransaction(tx, data);
      },
    });
    const deletion = delayedAudit.deleteTank(administrator, raceTank.id, revision(raceTank));
    await prepared;
    const purchase = new PurchaseOrdersService(db);
    const receipt = db.$transaction((tx) =>
      purchase.resolveAllocatedFuelTankForReceipt({
        tx,
        tankId: raceTank.id,
        branchId: branch.id,
        companyId: company.id,
        productId: product.id,
      }),
    );
    // Attach the rejection handler before releasing the row lock.
    const rejectedReceipt = assert.rejects(receipt, /must be active/);
    release();
    await deletion;
    await rejectedReceipt;
    assert.equal(
      Number(
        (await db.fuelTank.findUniqueOrThrow({ where: { id: raceTank.id } })).currentBookBalance,
      ),
      0,
    );
    // Opposite ordering: an in-flight receipt keeps its tank row while an
    // equipment deletion holds the station lock. Its branch FK check must
    // still complete, rather than deadlocking the receipt and configuration.
    const receivingTank = await createTank('RECEIPT-FIRST');
    let receiptPrepared, stationLocked;
    const receiptReady = new Promise((resolve) => {
      receiptPrepared = resolve;
    });
    const stationReady = new Promise((resolve) => {
      stationLocked = resolve;
    });
    const concurrentFuel = new FuelReportingService(db, scope, audit);
    const originalLock = concurrentFuel.lock.bind(concurrentFuel);
    concurrentFuel.lock = async (...args) => {
      await originalLock(...args);
      stationLocked();
    };
    const receiving = db.$transaction(async (tx) => {
      await purchase.resolveAllocatedFuelTankForReceipt({
        tx,
        tankId: receivingTank.id,
        branchId: branch.id,
        companyId: company.id,
        productId: product.id,
      });
      receiptPrepared();
      await stationReady;
      await tx.$queryRaw`SELECT "id" FROM "branches" WHERE "id" = ${branch.id} FOR KEY SHARE`;
      await tx.fuelTank.update({
        where: { id: receivingTank.id },
        data: { currentBookBalance: { increment: 100 } },
      });
    });
    await receiptReady;
    const refusedDeletion = assert.rejects(
      () => concurrentFuel.deleteTank(administrator, receivingTank.id, revision(receivingTank)),
      /another window|fuel balance/,
    );
    await receiving;
    await refusedDeletion;
    const receivedTank = await db.fuelTank.findUniqueOrThrow({ where: { id: receivingTank.id } });
    assert.equal(Number(receivedTank.currentBookBalance), 100);
    assert.equal(receivedTank.deletedAt, null);
    assert(
      await db.auditLog.count({
        where: { action: 'FUEL_REPORTING_TANK_DELETE', entityId: spare.id },
      }),
    );
    console.log(
      JSON.stringify({
        ok: true,
        checks: [
          'validated authenticated APIs',
          'administrator and company WRITE permissions',
          'PetroDollar company boundary',
          'draft and connected-tank deletion blocks',
          'manual remaining-fuel deletion block',
          'delete/restore catalog and identity',
          'unchanged historical reports and revisions',
          'concurrent edits: one success, one conflict',
          'retained nozzle IDs and meter values',
          'pump removal/restoration without deleted nozzles',
          'atomic audit rollback',
          'purchase receipt revalidation after deletion',
          'receipt-first concurrency completes without a branch FK deadlock',
        ],
      }),
    );
    if (process.argv.includes('--serve')) {
      console.log(
        JSON.stringify({
          databaseName: name,
          fixtureApi: `http://127.0.0.1:${port}/api/v1`,
          branchId: branch.id,
          workspaceRoute,
          tankId: spare.id,
          pumpId: pump.id,
        }),
      );
      await new Promise((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
    }
  } finally {
    await app?.close();
    await db.$disconnect();
    assert(/^fuel_equipment_verify_\d+$/.test(name));
    await adminDb.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await adminDb.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
