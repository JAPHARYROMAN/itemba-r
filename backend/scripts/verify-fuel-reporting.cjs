/* Isolated database/API verification. Never migrates or writes the configured app database.
 * Run from backend: node scripts/verify-fuel-reporting.cjs [--serve]
 * --serve keeps the fixture API on localhost:3014 for browser verification.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '../tsconfig.json'),
});
require('reflect-metadata');
const { PrismaClient } = require('@prisma/client');
const { Test } = require('@nestjs/testing');
const { Reflector } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const {
  FuelReportingController,
} = require('../src/modules/fuel-reporting/fuel-reporting.controller');
const { FuelReportingService } = require('../src/modules/fuel-reporting/fuel-reporting.service');
const { CompanyScopeService } = require('../src/common/services/company-scope.service');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'Verification only supports a local PostgreSQL server.',
  );
  const name = `fuel_reporting_verify_${Date.now()}`;
  const admin = new PrismaClient();
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const env = { ...process.env, DATABASE_URL: url.toString() };
  const root = path.resolve(__dirname, '../..');
  let app;
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  async function cleanup() {
    await app?.close();
    await db.$disconnect();
    assert(/^fuel_reporting_verify_\d+$/.test(name));
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  }
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
      { env, cwd: root, encoding: 'utf8', timeout: 180000 },
    );
    assert.equal(push.status, 0, push.stderr || 'Unable to create isolated schema');
    // Exercise the actual SQL migration, including its CHECKs and permission grants.
    await db.$executeRawUnsafe('DROP TABLE "fuel_report_revisions"');
    await db.$executeRawUnsafe('DROP TABLE "fuel_reports"');
    for (const role of ['GROUP_SUPER_ADMIN', 'BRANCH_MANAGER', 'PUMP_ATTENDANT'])
      await db.role.create({
        data: {
          name: role,
          displayName: role,
          scope: role === 'GROUP_SUPER_ADMIN' ? 'GROUP' : 'BRANCH',
        },
      });
    const migrate = spawnSync(
      'psql',
      [
        '--host',
        url.hostname,
        '--port',
        url.port || '5432',
        '--username',
        decodeURIComponent(url.username),
        '--dbname',
        name,
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        path.join(root, 'database/prisma/migrations/20260905120000_fuel_reporting/migration.sql'),
      ],
      {
        env: { ...env, PGPASSWORD: decodeURIComponent(url.password) },
        encoding: 'utf8',
        timeout: 60000,
      },
    );
    assert.equal(migrate.status, 0, migrate.stderr || 'Migration failed');
    assert.equal(await db.rolePermission.count({ where: { role: { name: 'PUMP_ATTENDANT' } } }), 0);
    assert.equal(await db.rolePermission.count({ where: { role: { name: 'BRANCH_MANAGER' } } }), 2);
    const group = await db.group.create({ data: { code: 'TEST', name: 'Verification group' } });
    const company = await db.company.create({
      data: { groupId: group.id, code: 'MWANJALISI', name: 'MWANJALISI OIL' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, code: 'PETRO', name: 'Petroleum', type: 'PETROLEUM' },
    });
    const branch = await db.branch.create({
      data: {
        divisionId: division.id,
        code: 'VERIFY-01',
        name: 'Verification Station',
        type: 'FUEL_STATION',
      },
    });
    const other = await db.branch.create({
      data: {
        divisionId: division.id,
        code: 'VERIFY-02',
        name: 'Other Station',
        type: 'FUEL_STATION',
      },
    });
    const user = await db.user.create({
      data: {
        email: 'fuel-reporting@example.test',
        fullName: 'Station Manager',
        passwordHash: 'verification-only',
        companyId: company.id,
      },
    });
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
      },
    });
    const diesel = await db.product.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        baseUnitId: unit.id,
        name: 'Diesel',
        productCode: 'DIESEL',
      },
    });
    const manager = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: ['BRANCH_MANAGER'],
      roleScopes: ['BRANCH'],
      companyId: company.id,
      permissions: ['fuel_reporting.read', 'fuel_reporting.manage'],
      companyAccess: [{ companyId: company.id, accessLevel: 'MANAGE' }],
      branchAccess: [{ branchId: branch.id, accessLevel: 'WRITE' }],
    };
    const administrator = {
      ...manager,
      fullName: 'Reporting Admin',
      roles: ['GROUP_SUPER_ADMIN'],
      roleScopes: ['GROUP'],
      permissions: [...manager.permissions, 'fuel_reporting.admin'],
    };
    const audit = { log: async () => {}, logStrict: async () => {} };
    const service = new FuelReportingService(db, new CompanyScopeService(db), audit);
    const tank = await service.createTank(administrator, {
      branchId: branch.id,
      productId: product.id,
      name: 'Petrol Tank 1',
      code: 'TK-01',
      capacityLitres: 30000,
    });
    const tank2 = await service.createTank(administrator, {
      branchId: branch.id,
      productId: diesel.id,
      name: 'Diesel Tank 1',
      code: 'TK-02',
      capacityLitres: 40000,
    });
    const pump = await service.createPump(administrator, {
      branchId: branch.id,
      name: 'Pump 1',
      code: 'PUMP-01',
      nozzles: [
        { code: 'N1', tankId: tank.id },
        { code: 'N2', tankId: tank2.id },
      ],
    });
    const nozzle = await db.fuelNozzle.findFirstOrThrow({
      where: { pumpId: pump.id, nozzleCode: 'N1' },
    });
    const nozzle2 = await db.fuelNozzle.findFirstOrThrow({
      where: { pumpId: pump.id, nozzleCode: 'N2' },
    });
    const module = await Test.createTestingModule({
      controllers: [FuelReportingController],
      providers: [{ provide: FuelReportingService, useValue: service }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.use((req, res, next) => {
      const token = req.headers.authorization;
      req.user =
        token === 'Bearer fixture-manager'
          ? manager
          : token === 'Bearer fixture-admin'
            ? administrator
            : undefined;
      next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector(), audit));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(process.argv.includes('--serve') ? 3014 : 0, '127.0.0.1');
    const port = app.getHttpServer().address().port;
    async function api(route, body, token = 'fixture-manager') {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/fuel-reporting/${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() };
    }
    assert.equal((await api('bootstrap', null, '')).status, 401);
    assert.equal((await api(`history?branchId=${other.id}`)).status, 403);
    assert.equal((await api('history')).status, 400);
    assert.equal(
      (await api('pumps', { branchId: branch.id, name: 'Unauthorized', code: 'BAD', nozzles: [] }))
        .status,
      403,
    );
    const payload = {
      readings: [
        {
          nozzleId: nozzle.id,
          attendantName: 'Asha Juma',
          opening: 1000,
          closing: 1100,
          price: 3000,
        },
        {
          nozzleId: nozzle2.id,
          attendantName: 'John Musa',
          opening: 2000,
          closing: 2000,
          price: 2900,
        },
      ],
      dips: [
        { tankId: tank.id, opening: 1000, closing: 1900 },
        { tankId: tank2.id, opening: 1000, closing: 1000 },
      ],
      deliveries: [
        {
          productId: product.id,
          litres: 1000,
          supplier: '',
          reference: 'DN-1',
          totalCost: null,
          paidAmount: 0,
          paymentSource: 'OTHER',
        },
      ],
      expenses: [],
      creditSales: [],
      collections: { cash: 300000, mobile: 0, bank: 0, openingCash: 0, cashHandedOver: 300000 },
      receiptsConfirmed: true,
      expensesConfirmed: true,
      notes: 'Integration test',
      discrepancyReason: '',
      documentIds: [],
    };
    const dto = {
      branchId: branch.id,
      businessDate: '2026-09-01',
      shift: 'DAY',
      version: 0,
      payload,
    };
    const missingDip = structuredClone(dto);
    missingDip.payload.dips[0].closing = null;
    missingDip.close = true;
    assert.equal((await api('reports', missingDip)).status, 400);
    assert.equal(await db.fuelReport.count(), 0);
    const saved = await api('reports', dto);
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.equal(saved.body.version, 1);
    assert.equal((await api('reports', dto)).status, 409);
    const closed = await api('reports', { ...dto, version: 1, close: true });
    assert.equal(closed.status, 201, JSON.stringify(closed.body));
    assert.equal(closed.body.status, 'CLOSED');
    assert.equal(closed.body.summary.flagged, 0);
    assert.equal((await api('reports', { ...dto, version: 2 })).status, 409);
    const reopened = await api(`reports/${closed.body.id}/reopen`, {
      version: 2,
      reason: 'Paper dipping correction',
    });
    assert.equal(reopened.body.version, 3);
    const corrected = structuredClone(dto);
    corrected.version = 3;
    corrected.close = true;
    corrected.payload.dips[0].closing = 1898;
    corrected.payload.discrepancyReason = 'Two-litre shortage confirmed on paper';
    const correction = await api('reports', corrected);
    assert.equal(correction.status, 201, JSON.stringify(correction.body));
    assert.equal(correction.body.summary.flagged, 1);
    const revisions = await api(`reports/${closed.body.id}/revisions`);
    assert.equal(revisions.body.length, 4);
    assert.equal(revisions.body.find((r) => r.version === 2).payload.dips[0].closing, 1900);
    const night = structuredClone(dto);
    night.shift = 'NIGHT';
    night.payload.deliveries = [];
    night.payload.readings[0].opening = 1100;
    night.payload.readings[0].closing = 1200;
    night.payload.dips[0].opening = 1898;
    night.payload.dips[0].closing = 1798;
    night.close = true;
    const nightReport = await api('reports', night);
    assert.equal(nightReport.status, 201, JSON.stringify(nightReport.body));
    const workspace = await api(
      `workspace?branchId=${branch.id}&businessDate=2026-09-01&shift=NIGHT`,
    );
    assert.equal(workspace.body.daily.filter((r) => r.status === 'CLOSED').length, 2);
    assert.equal(
      (await api(`reports/${closed.body.id}/reopen`, { version: 4, reason: 'Late correction' }))
        .status,
      409,
    );
    const race = { ...dto, businessDate: '2026-09-02' };
    const raced = await Promise.all([api('reports', race), api('reports', race)]);
    assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await db.fuelReport.count({ where: { businessDate: new Date('2026-09-02') } }), 1);
    // The second date remains a draft to exercise manager UI resume behavior.
    const persisted = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    assert.equal(
      (await persisted.fuelReport.findUnique({ where: { id: closed.body.id } })).summary.stock[0]
        .difference,
      -2,
    );
    await persisted.$disconnect();
    assert.equal((await api('stations')).status, 403);
    const stations = await api('stations', undefined, 'fixture-admin');
    assert(stations.body.divisions.some((d) => d.id === division.id));
    const newStation = {
      divisionId: division.id,
      code: 'TEST-NEW',
      name: 'New station',
      location: 'Test town',
    };
    assert.equal((await api('stations', newStation)).status, 403);
    assert.equal(
      (await api('stations', { ...newStation, name: '   ' }, 'fixture-admin')).status,
      400,
    );
    const createdStation = await api('stations', newStation, 'fixture-admin');
    assert.equal(createdStation.status, 201, JSON.stringify(createdStation.body));
    const stationId = createdStation.body.id;
    assert.equal(
      (await api('stations', { ...newStation, code: 'test-new' }, 'fixture-admin')).status,
      409,
    );
    assert.equal(
      (
        await api(
          `stations/${stationId}/update`,
          { code: 'RENAMED', name: 'Renamed station', location: 'New town' },
          'fixture-admin',
        )
      ).status,
      201,
    );
    assert.equal((await api(`stations/${stationId}/deactivate`, {})).status, 403);
    assert.equal((await api(`stations/${branch.id}/deactivate`, {}, 'fixture-admin')).status, 409);
    assert.equal((await api(`stations/${stationId}/deactivate`, {}, 'fixture-admin')).status, 201);
    assert(
      !(await api('bootstrap', undefined, 'fixture-admin')).body.branches.some(
        (b) => b.id === stationId,
      ),
    );
    assert.equal(
      (
        await api(
          `workspace?branchId=${stationId}&businessDate=2026-09-02&shift=DAY`,
          undefined,
          'fixture-admin',
        )
      ).status,
      404,
    );
    assert.equal((await api(`stations/${stationId}/restore`, {}, 'fixture-admin')).status, 201);
    assert(
      (await api('bootstrap', undefined, 'fixture-admin')).body.branches.some(
        (b) => b.id === stationId,
      ),
    );
    assert.equal(await db.fuelReportRevision.count({ where: { reportId: closed.body.id } }), 4);
    console.log(
      'PASS: station create/edit/remove/restore, manager denial, duplicate and blank validation, draft removal protection, selection refresh and retained revisions.',
    );
    console.log(
      'PASS: migration, authorization, branch isolation, required dips, duplicate/stale saves, concurrency, closure, correction history, daily totals and independent-client persistence.',
    );
    if (process.argv.includes('--serve') || process.argv.includes('--browser')) {
      const fixture = {
        manager,
        administrator,
        branchId: branch.id,
        otherBranchId: other.id,
        baseUrl: `http://127.0.0.1:${port}/api/v1`,
        date: '2026-09-02',
      };
      const output = path.join(root, '.tmp-fuel-reporting');
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'fixture.json'), JSON.stringify(fixture));
      if (process.argv.includes('--browser')) {
        const code = await new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [path.join(root, 'scripts/smoke-fuel-reporting.mjs')],
            {
              cwd: root,
              env: { ...process.env, FUEL_REPORTING_DIRECT_FIXTURE: '1' },
              stdio: 'inherit',
            },
          );
          child.on('error', reject);
          child.on('exit', resolve);
        });
        assert.equal(code, 0, 'Browser verification failed');
        return;
      }
      console.log(
        'Fixture API ready on localhost:3014; press Ctrl+C to remove the isolated database.',
      );
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
