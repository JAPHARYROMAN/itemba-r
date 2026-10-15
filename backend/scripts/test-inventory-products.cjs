/* Real product/API proof. All writes target a fresh disposable loopback database.
 * Set INVENTORY_PRODUCT_TEST_DATABASE_URL; --retain saves a local UI fixture.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
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
const { ProductsService } = require('../src/modules/products/products.service');
const { ProductsController } = require('../src/modules/products/products.controller');
const { ProfitService } = require('../src/modules/profit/profit.service');
const { AuditLogsService } = require('../src/modules/audit-logs/audit-logs.service');
const { CompanyScopeService } = require('../src/common/services/company-scope.service');
const { OrganizationScopeService } = require('../src/common/services/organization-scope.service');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard');
const { ALL_PERMISSIONS } = require('../../database/seeds/permission-matrix');
const argon2 = require('argon2');

async function main() {
  const target = new URL(
    process.env.INVENTORY_PRODUCT_TEST_DATABASE_URL ??
      process.env.CUSTOMER_PERFORMANCE_TEST_DATABASE_URL ??
      process.env.DATABASE_URL,
  );
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname),
    'Only loopback PostgreSQL is allowed',
  );
  const database = `inventory_product_test_${randomUUID().replaceAll('-', '')}`;
  assert(/^inventory_product_test_[a-f0-9]{32}$/.test(database));
  const retain = process.argv.includes('--retain');
  const admin = new PrismaClient({ datasources: { db: { url: target.toString() } } });
  let db,
    app,
    created = false,
    success = false;
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
      {
        env: { ...process.env, DATABASE_URL: target.toString() },
        stdio: 'pipe',
        timeout: 180000,
      },
    );
    db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
    const group = await db.group.create({
      data: { name: 'Disposable inventory UX', code: 'INV-PROOF' },
    });
    const company = await db.company.create({
      data: { groupId: group.id, name: 'Inventory Proof Trading', code: 'INV-CO' },
    });
    const foreignCompany = await db.company.create({
      data: { groupId: group.id, name: 'Restricted Proof Company', code: 'INV-OTHER' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, name: 'Trading', code: 'INV-TR', type: 'OTHER' },
    });
    const foreignDivision = await db.division.create({
      data: { companyId: foreignCompany.id, name: 'Other Trading', code: 'INV-OT', type: 'OTHER' },
    });
    const branch = await db.branch.create({
      data: { divisionId: division.id, name: 'Central Store', code: 'INV-CENTRAL', type: 'BRANCH' },
    });
    const hiddenBranch = await db.branch.create({
      data: {
        divisionId: division.id,
        name: 'Restricted Store',
        code: 'INV-RESTRICTED',
        type: 'BRANCH',
      },
    });
    const foreignBranch = await db.branch.create({
      data: {
        divisionId: foreignDivision.id,
        name: 'Other Company Store',
        code: 'INV-OTHER-BR',
        type: 'BRANCH',
      },
    });
    const category = await db.productCategory.create({
      data: { companyId: company.id, name: 'Trading goods', categoryType: 'TRADING_GOODS' },
    });
    const unit = await db.unitOfMeasure.create({
      data: {
        companyId: company.id,
        name: 'Piece',
        symbol: 'pc',
        unitType: 'PIECE',
        isBaseUnit: true,
      },
    });
    const alternateUnit = await db.unitOfMeasure.create({
      data: { companyId: company.id, name: 'Pack', symbol: 'pack', unitType: 'PACKAGE' },
    });
    const password = `Inventory-Proof-${randomUUID()}`;
    const actor = await db.user.create({
      data: {
        email: 'inventory-proof@example.invalid',
        passwordHash: await argon2.hash(password),
        fullName: 'Inventory proof operator',
        companyId: company.id,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });
    const role = await db.role.create({
      data: {
        name: 'GROUP_SUPER_ADMIN',
        displayName: 'Disposable proof administrator',
        scope: 'GROUP',
        isSystem: false,
      },
    });
    await db.permission.createMany({ data: ALL_PERMISSIONS });
    const permissions = await db.permission.findMany();
    await db.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
    });
    await db.userRole.create({ data: { userId: actor.id, roleId: role.id } });
    await db.userCompanyAccess.create({
      data: { userId: actor.id, companyId: company.id, accessLevel: 'MANAGE' },
    });
    await db.userDivisionAccess.create({
      data: { userId: actor.id, divisionId: division.id, accessLevel: 'MANAGE' },
    });
    await db.userBranchAccess.create({
      data: { userId: actor.id, branchId: branch.id, accessLevel: 'MANAGE' },
    });
    const year = new Date().getUTCFullYear();
    const fiscalYear = await db.fiscalYear.create({
      data: {
        companyId: company.id,
        name: String(year),
        startDate: new Date(`${year}-01-01T00:00:00Z`),
        endDate: new Date(`${year}-12-31T23:59:59Z`),
      },
    });
    await db.accountingPeriod.create({
      data: {
        companyId: company.id,
        fiscalYearId: fiscalYear.id,
        name: 'Proof open year',
        startDate: fiscalYear.startDate,
        endDate: fiscalYear.endDate,
      },
    });
    for (const [code, name, type, subtype] of [
      ['1300', 'Inventory', 'ASSET', 'inventory'],
      ['5900', 'Inventory count variance', 'EXPENSE', 'inventory_adjustment_variance'],
    ])
      await db.chartOfAccount.create({
        data: {
          companyId: company.id,
          accountCode: code,
          accountName: name,
          accountType: type,
          accountSubType: subtype,
        },
      });
    await db.companyProfile.create({
      data: {
        companyId: company.id,
        registeredName: company.name,
        brelaRegNumber: 'INV-PROOF',
        tin: 'INV-PROOF',
        registeredAddress: 'Local disposable fixture',
        currency: 'TZS',
      },
    });
    const user = {
      id: actor.id,
      email: actor.email,
      fullName: actor.fullName,
      roles: ['GROUP_SUPER_ADMIN'],
      roleScopes: ['GROUP'],
      permissions: permissions.map((p) => p.code),
      companyId: company.id,
      companyAccess: [{ companyId: company.id, accessLevel: 'MANAGE' }],
      divisionAccess: [{ divisionId: division.id, accessLevel: 'MANAGE' }],
      branchAccess: [{ branchId: branch.id, accessLevel: 'MANAGE' }],
    };
    const restricted = {
      ...user,
      roleScopes: ['BRANCH'],
      divisionAccess: [],
      branchAccess: [{ branchId: branch.id, accessLevel: 'READ' }],
    };
    const viewer = { ...restricted, permissions: ['products.view', 'inventory.view'] };
    const scope = new CompanyScopeService(db);
    const organization = new OrganizationScopeService(db);
    const audit = new AuditLogsService(db);
    const profit = new ProfitService(db, scope, audit);
    const products = new ProductsService(db, audit, scope, profit, {}, organization);
    const base = {
      companyId: company.id,
      divisionId: division.id,
      categoryId: category.id,
      baseUnitId: unit.id,
      productType: 'STOCK_ITEM',
      trackInventory: true,
      defaultPurchasePrice: 1000,
      defaultSellingPrice: 1600,
    };
    await db.product.createMany({
      data: Array.from({ length: 1000 }, (_, index) => ({
        ...base,
        productCode: `FUZZY-${String(index).padStart(4, '0')}`,
        name: `A lookup-exact item ${String(index).padStart(4, '0')}`,
        sku: null,
        barcode: null,
      })),
    });
    const exact = await db.product.create({
      data: {
        ...base,
        productCode: 'LOOKUP-EXACT',
        name: 'Z exact identifier result',
        sku: null,
        barcode: null,
      },
    });
    const water = await db.product.create({
      data: { ...base, name: 'Water 500ml', productCode: 'WAT-500-A', barcode: '6001234567890' },
    });
    const duplicate = await db.product.create({
      data: { ...base, name: 'Water 500ml', productCode: 'WAT-500-B' },
    });
    const negative = await db.product.create({
      data: { ...base, name: 'Twiga Cement 50kg', productCode: 'CEM-50', sku: 'TWIGA-50' },
    });
    const missing = await db.product.create({
      data: { ...base, name: 'New stock product', productCode: 'NEW-STOCK' },
    });
    const legacy = await db.product.create({
      data: {
        ...base,
        name: 'Legacy metadata-only product',
        productCode: 'LEGACY-NAME',
        defaultPurchasePrice: null,
        defaultSellingPrice: null,
      },
    });
    await db.inventoryBalance.createMany({
      data: [
        {
          companyId: company.id,
          divisionId: division.id,
          branchId: branch.id,
          productId: water.id,
          quantityOnHand: 42,
          quantityReserved: 2,
          averageCost: 1000,
          totalValue: 42000,
        },
        {
          companyId: company.id,
          divisionId: division.id,
          branchId: hiddenBranch.id,
          productId: water.id,
          quantityOnHand: 999,
          quantityReserved: 0,
          averageCost: 1000,
          totalValue: 999000,
        },
        {
          companyId: company.id,
          divisionId: division.id,
          branchId: branch.id,
          productId: negative.id,
          quantityOnHand: -2,
          quantityReserved: 3,
          averageCost: 1000,
          totalValue: -2000,
        },
      ],
    });
    const started = performance.now();
    const lookup = await products.findAll(
      { companyId: company.id, branchId: branch.id, search: ' lookup-EXACT ', limit: 8 },
      restricted,
    );
    const lookupMs = Math.round(performance.now() - started);
    assert.equal(lookup.total, 1001);
    assert.equal(lookup.data.length, 8, 'Null SKU/barcode fuzzy matches must remain visible');
    assert.equal(lookup.data[0].id, exact.id, 'Exact code beyond alphabetic limit must rank first');
    const second = await products.findAll(
      { companyId: company.id, search: 'lookup-exact', limit: 8, page: 2 },
      user,
    );
    assert.equal(second.data.length, 8);
    assert.equal(new Set([...lookup.data, ...second.data].map((p) => p.id)).size, 16);
    const scoped = await products.findAll(
      { companyId: company.id, branchId: branch.id, search: 'WAT-500-A' },
      restricted,
    );
    assert.equal(scoped.data[0].availableQuantity, 40);
    assert.equal(scoped.data[0].inventoryBalance.quantityOnHand, 42);
    const debtStock = await products.findAll(
      { companyId: company.id, branchId: branch.id, search: 'TWIGA-50' },
      restricted,
    );
    assert.equal(debtStock.data[0].availableQuantity, -5);
    await assert.rejects(
      products.findAll({ companyId: company.id, branchId: hiddenBranch.id }, restricted),
      (error) => error.getStatus?.() === 403,
    );
    await assert.rejects(
      products.findAll({ companyId: company.id, branchId: foreignBranch.id }, user),
      (error) => error.getStatus?.() === 403,
    );
    const stamp = legacy.updatedAt.toISOString();
    const edits = await Promise.allSettled([
      products.update(legacy.id, { name: '  Metadata editor A  ', expectedUpdatedAt: stamp }, user),
      products.update(legacy.id, { name: '  Metadata editor B  ', expectedUpdatedAt: stamp }, user),
    ]);
    assert.equal(edits.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      edits.filter((result) => result.status === 'rejected' && result.reason.getStatus?.() === 409)
        .length,
      1,
    );
    const renamed = await db.product.findUniqueOrThrow({ where: { id: legacy.id } });
    assert(renamed.name === 'Metadata editor A' || renamed.name === 'Metadata editor B');
    assert.equal(
      await db.auditLog.count({
        where: { entityType: 'Product', entityId: legacy.id, action: 'PRODUCT_UPDATE' },
      }),
      1,
    );
    const familyCount = await db.productFamily.count();
    await assert.rejects(
      products.update(
        legacy.id,
        { productFamilyName: 'Must never be created', expectedUpdatedAt: stamp },
        user,
      ),
      (error) => error.getStatus?.() === 409,
    );
    assert.equal(await db.productFamily.count(), familyCount);
    const brokenAudit = new ProductsService(
      db,
      {
        logStrictInTransaction: async () => {
          throw new Error('Proof audit failure');
        },
      },
      scope,
      profit,
      {},
      organization,
    );
    await assert.rejects(
      brokenAudit.update(
        legacy.id,
        { name: 'Must roll back', expectedUpdatedAt: renamed.updatedAt.toISOString() },
        user,
      ),
      /Proof audit failure/,
    );
    assert.equal(
      (await db.product.findUniqueOrThrow({ where: { id: legacy.id } })).name,
      renamed.name,
    );
    await assert.rejects(products.update(legacy.id, { name: '   ' }, user), /cannot be blank/);
    await assert.rejects(
      products.update(legacy.id, { defaultSellingPrice: 1600 }, user),
      /purchase cost/,
    );
    const history = await db.product.create({
      data: { ...base, name: 'History protected product', productCode: 'HISTORY-GUARD' },
    });
    await db.inventoryMovement.create({
      data: {
        companyId: company.id,
        divisionId: division.id,
        branchId: branch.id,
        productId: history.id,
        movementNumber: 'MOV-HISTORY',
        movementType: 'OPENING_STOCK',
        quantity: 1,
        unitId: unit.id,
        unitCost: 1000,
        totalCost: 1000,
        movementDate: new Date(),
        createdById: actor.id,
      },
    });
    await assert.rejects(
      products.update(history.id, { baseUnitId: alternateUnit.id }, user),
      /base unit cannot change/,
    );
    await assert.rejects(
      products.update(water.id, { trackInventory: false }, user),
      /tracking cannot be disabled/,
    );
    for (const productType of ['SERVICE', 'NON_STOCK_ITEM']) {
      await assert.rejects(
        products.update(water.id, { productType }, user),
        /stock, reservations or stock value remain/,
      );
      const guarded = await db.product.findUniqueOrThrow({ where: { id: water.id } });
      assert.equal(guarded.productType, 'STOCK_ITEM');
      assert.equal(guarded.trackInventory, true);
    }
    for (const [label, field] of [
      ['Reservation', 'quantityReserved'],
      ['Stock value', 'totalValue'],
    ]) {
      const protectedProduct = await db.product.create({
        data: { ...base, name: `${label} protected`, productCode: `GUARD-${field}` },
      });
      await db.inventoryBalance.create({
        data: {
          companyId: company.id,
          productId: protectedProduct.id,
          branchId: branch.id,
          quantityOnHand: 0,
          quantityReserved: 0,
          totalValue: 0,
          [field]: 1,
        },
      });
      await assert.rejects(
        products.update(protectedProduct.id, { trackInventory: false }, user),
        /tracking cannot be disabled/,
      );
      for (const productType of ['SERVICE', 'NON_STOCK_ITEM']) {
        await assert.rejects(
          products.update(protectedProduct.id, { productType }, user),
          /stock, reservations or stock value remain/,
        );
        assert.equal(
          (await db.product.findUniqueOrThrow({ where: { id: protectedProduct.id } })).productType,
          'STOCK_ITEM',
        );
      }
    }
    const unused = await db.product.create({
      data: { ...base, name: 'Unused unit test', productCode: 'UNIT-UNUSED' },
    });
    assert.equal(
      (await products.update(unused.id, { baseUnitId: alternateUnit.id }, user)).baseUnitId,
      alternateUnit.id,
    );
    assert.equal(
      (await products.update(unused.id, { productType: 'SERVICE' }, user)).productType,
      'SERVICE',
    );
    const testingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: products }],
    }).compile();
    app = testingModule.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalGuards(
      {
        canActivate: (context) => {
          const req = context.switchToHttp().getRequest();
          req.user = req.headers['x-proof-user'] === 'viewer' ? viewer : restricted;
          return true;
        },
      },
      new PermissionsGuard(new Reflector(), audit),
    );
    await app.listen(0, '127.0.0.1');
    const api = await app.getUrl();
    assert.equal(
      (await fetch(`${api}/products?companyId=${company.id}&branchId=${hiddenBranch.id}`)).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${api}/products/${legacy.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-proof-user': 'viewer' },
          body: JSON.stringify({ name: 'Forbidden viewer update' }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${api}/products/${legacy.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '   ' }),
        })
      ).status,
      400,
    );
    const response = await fetch(
      `${api}/products?companyId=${company.id}&branchId=${branch.id}&search=LOOKUP-EXACT&limit=8`,
    );
    assert.equal(response.status, 200);
    const apiLookup = await response.json();
    assert.equal(apiLookup.data[0].id, exact.id);
    assert.equal(apiLookup.data.length, 8);
    if (retain) {
      const fixtureFile = path.resolve(__dirname, '../../tmp/inventory-products-proof.json');
      await fs.mkdir(path.dirname(fixtureFile), { recursive: true });
      await fs.writeFile(
        fixtureFile,
        JSON.stringify(
          {
            database,
            databaseUrl: target.toString(),
            login: { email: actor.email, password },
            companyId: company.id,
            divisionId: division.id,
            branchId: branch.id,
            hiddenBranchId: hiddenBranch.id,
            categoryId: category.id,
            unitId: unit.id,
            products: {
              exact: exact.id,
              water: water.id,
              sameName: duplicate.id,
              negative: negative.id,
              missing: missing.id,
              legacy: legacy.id,
            },
            lookupMs,
            readiness:
              'Schema, active account, GROUP_SUPER_ADMIN permissions, grants, open fiscal period and inventory/variance accounts seeded.',
          },
          null,
          2,
        ),
      );
      console.log(`Retained local UI fixture: ${fixtureFile}`);
    }
    success = true;
    console.log(
      `PASS: PostgreSQL1000-row exact ranking/null-safe pagination (${lookupMs}ms), scoped branch/API permissions, negative availability, competing CAS, side-effect-free conflicts, strict audit rollback, price dependencies, base-unit history, stock/reservation/value guards and authenticating UI fixture.`,
    );
  } finally {
    await app?.close();
    await db?.$disconnect();
    if (created && !(retain && success))
      await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.$disconnect();
    if (!(retain && success)) console.log('Disposable Inventory Products database removed.');
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
