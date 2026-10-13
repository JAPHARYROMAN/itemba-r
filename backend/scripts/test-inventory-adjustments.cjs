/* All fixture writes are restricted to a fresh disposable loopback database. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const { AuditLogsService } = require('../src/modules/audit-logs/audit-logs.service');
const { CompanyScopeService } = require('../src/common/services/company-scope.service');
const { OrganizationScopeService } = require('../src/common/services/organization-scope.service');
const { AccountResolverService } = require('../src/common/services/account-resolver.service');
const { AccountingControlService } = require('../src/common/services/accounting-control.service');
const { PostingEngineService } = require('../src/modules/accounting-engine/posting-engine.service');
const {
  EntityCodeGeneratorService,
} = require('../src/modules/entity-code-generator/entity-code-generator.service');
const { ProfitService } = require('../src/modules/profit/profit.service');
const {
  InventoryMovementsService,
} = require('../src/modules/inventory-movements/inventory-movements.service');
const {
  StockAdjustmentsService,
} = require('../src/modules/stock-adjustments/stock-adjustments.service');

async function main() {
  const target = new URL(
    process.env.INVENTORY_ADJUSTMENT_TEST_DATABASE_URL ??
      process.env.CUSTOMER_PERFORMANCE_TEST_DATABASE_URL ??
      process.env.DATABASE_URL,
  );
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname),
    'Only loopback PostgreSQL is allowed',
  );
  const database = `inventory_adjustment_test_${randomUUID().replaceAll('-', '')}`;
  assert(/^inventory_adjustment_test_[a-f0-9]{32}$/.test(database));
  const admin = new PrismaClient({ datasources: { db: { url: target.toString() } } });
  let db;
  let created = false;
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
        timeout: 120000,
      },
    );
    db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
    const group = await db.group.create({ data: { name: 'Inventory proof', code: 'INV-PROOF' } });
    const company = await db.company.create({
      data: { groupId: group.id, name: 'Inventory proof', code: 'INV-A' },
    });
    const foreignCompany = await db.company.create({
      data: { groupId: group.id, name: 'Other company', code: 'INV-B' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, name: 'Trading', code: 'INV-D', type: 'OTHER' },
    });
    const branch = await db.branch.create({
      data: { divisionId: division.id, name: 'Count location', code: 'INV-LOC', type: 'BRANCH' },
    });
    const hiddenBranch = await db.branch.create({
      data: { divisionId: division.id, name: 'Hidden location', code: 'INV-HIDE', type: 'BRANCH' },
    });
    const actor = await db.user.create({
      data: {
        email: 'inventory-proof@example.invalid',
        passwordHash: 'non-authenticating-fixture',
        fullName: 'Inventory proof operator',
      },
    });
    const user = {
      id: actor.id,
      email: actor.email,
      roles: [],
      roleScopes: ['COMPANY'],
      permissions: [],
      companyAccess: [{ companyId: company.id, accessLevel: 'WRITE' }],
      divisionAccess: [],
      branchAccess: [],
    };
    const branchUser = {
      ...user,
      roleScopes: ['BRANCH'],
      branchAccess: [{ branchId: branch.id, accessLevel: 'WRITE' }],
    };
    const unit = await db.unitOfMeasure.create({
      data: { companyId: company.id, name: 'Each', symbol: 'ea', isBaseUnit: true },
    });
    const wrongUnit = await db.unitOfMeasure.create({
      data: { companyId: company.id, name: 'Box', symbol: 'box' },
    });
    const category = await db.productCategory.create({
      data: { companyId: company.id, name: 'Proof goods' },
    });
    const product = await db.product.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        productCode: 'PROOF-GOODS',
        name: 'Counted goods',
        baseUnitId: unit.id,
        defaultPurchasePrice: 10,
        trackInventory: true,
      },
    });
    const emptyProduct = await db.product.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        productCode: 'PROOF-EMPTY',
        name: 'Absent balance goods',
        baseUnitId: unit.id,
        defaultPurchasePrice: 10,
        trackInventory: true,
      },
    });
    const fiscalYear = await db.fiscalYear.create({
      data: {
        companyId: company.id,
        name: 'Proof year',
        startDate: new Date('2000-01-01'),
        endDate: new Date('2100-12-31'),
      },
    });
    const period = await db.accountingPeriod.create({
      data: {
        companyId: company.id,
        fiscalYearId: fiscalYear.id,
        name: 'Proof period',
        startDate: fiscalYear.startDate,
        endDate: fiscalYear.endDate,
      },
    });
    const inventoryAccount = await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode: '1300',
        accountName: 'Inventory',
        accountType: 'ASSET',
        accountSubType: 'inventory_asset',
      },
    });
    const varianceAccount = await db.chartOfAccount.create({
      data: {
        companyId: company.id,
        accountCode: '6999',
        accountName: 'Count variance',
        accountType: 'EXPENSE',
        accountSubType: 'inventory_adjustment_variance',
      },
    });
    const audit = new AuditLogsService(db);
    const companies = new CompanyScopeService(db);
    const organizations = new OrganizationScopeService(db);
    const resolver = new AccountResolverService(db);
    const posting = new PostingEngineService(db, new AccountingControlService(db), resolver);
    const movements = new InventoryMovementsService(
      db,
      audit,
      new EntityCodeGeneratorService(db),
      companies,
      new ProfitService(db, companies, audit),
    );
    const counts = new StockAdjustmentsService(
      db,
      audit,
      movements,
      companies,
      posting,
      resolver,
      organizations,
    );
    const tuple = { companyId: company.id, productId: product.id, branchId: branch.id };
    const balance = () =>
      db.inventoryBalance.findUniqueOrThrow({ where: { companyId_productId_branchId: tuple } });
    const receive = (quantity, tx) =>
      movements.createMovement({
        ...tuple,
        quantity,
        unitId: unit.id,
        unitCost: 10,
        movementType: 'PURCHASE_RECEIPT',
        movementDate: new Date(),
        createdById: actor.id,
        tx,
      });
    const request = (countedQuantity, revision, key = randomUUID()) => ({
      companyId: company.id,
      branchId: branch.id,
      reason: 'Physical count proof',
      idempotencyKey: key,
      lines: [
        { productId: product.id, unitId: unit.id, countedQuantity, expectedRevision: revision },
      ],
    });
    const approve = async (run) => {
      await counts.submit(run.id, user, { expectedUpdatedAt: run.updatedAt.toISOString() });
      await counts.approve(run.id, user);
    };
    const snapshot = async (id) => ({
      run: await db.stockAdjustment.findUniqueOrThrow({ where: { id } }),
      balance: await balance(),
      movements: await db.inventoryMovement.count({
        where: { referenceType: 'StockAdjustment', referenceId: id },
      }),
      journals: await db.journalEntry.count({
        where: { referenceType: 'StockAdjustment', referenceId: id },
      }),
    });
    const assertRollback = async (id, before) => assert.deepEqual(await snapshot(id), before);

    await receive(10);
    let stock = await balance();
    assert.equal(stock.physicalRevision, 1);
    const frozenRequest = request(8, 1, 'same-physical-count');
    const run = await counts.create(frozenRequest, branchUser);
    assert.equal(run.lines[0].systemQuantity.toString(), '10');
    assert.equal(run.lines[0].varianceQuantity.toString(), '-2');
    assert.equal((await balance()).quantityOnHand.toString(), '10');
    await receive(2);
    const concurrentKey = request(8, 2, 'concurrent-create-key');
    const concurrentCreates = await Promise.all([
      counts.create(concurrentKey, user),
      counts.create(concurrentKey, user),
    ]);
    assert.equal(concurrentCreates[0].id, concurrentCreates[1].id);
    assert.equal(
      await db.stockAdjustment.count({ where: { idempotencyKey: 'concurrent-create-key' } }),
      1,
    );
    await counts.update(concurrentCreates[0].id, { notes: 'Edited in another window' }, user);
    await assert.rejects(
      counts.create(concurrentKey, user),
      (error) => error.getResponse().code === 'STOCK_COUNT_CHANGED',
    );
    assert.equal((await counts.create(frozenRequest, branchUser)).id, run.id);
    assert.equal(
      await db.stockAdjustment.count({ where: { idempotencyKey: 'same-physical-count' } }),
      1,
    );
    await assert.rejects(
      counts.create(
        { ...frozenRequest, lines: [{ ...frozenRequest.lines[0], countedQuantity: 7 }] },
        user,
      ),
      /different stock count/,
    );
    await assert.rejects(counts.create(request(8, 1), user), /Stock changed/);
    await assert.rejects(
      counts.create({ ...request(8, 2), branchId: hiddenBranch.id }, branchUser),
      /access/,
    );
    await assert.rejects(
      counts.create({ ...request(8, 2), companyId: foreignCompany.id }, user),
      /access/,
    );
    await assert.rejects(
      counts.create(
        {
          ...request(8, 2),
          lines: [{ productId: product.id, unitId: wrongUnit.id, countedQuantity: 8 }],
        },
        user,
      ),
      /base unit/,
    );
    for (const lines of [
      [],
      [{ productId: product.id, unitId: unit.id, countedQuantity: -1 }],
      [frozenRequest.lines[0], frozenRequest.lines[0]],
    ]) {
      await assert.rejects(counts.create({ ...request(8, 2), lines }, user));
    }
    const absent = await counts.create(
      {
        companyId: company.id,
        branchId: branch.id,
        reason: 'Empty tuple',
        lines: [
          { productId: emptyProduct.id, unitId: unit.id, countedQuantity: 0, expectedRevision: 0 },
        ],
      },
      user,
    );
    assert.equal(absent.lines[0].systemQuantity.toString(), '0');
    await db.stockAdjustment.update({ where: { id: absent.id }, data: { divisionId: null } });
    const divisionUser = {
      ...user,
      roleScopes: ['DIVISION'],
      divisionAccess: [{ divisionId: division.id, accessLevel: 'WRITE' }],
    };
    assert.equal((await counts.findOne(absent.id, divisionUser)).id, absent.id);
    assert(
      (await counts.findAll({ companyId: company.id }, divisionUser)).data.some(
        (row) => row.id === absent.id,
      ),
    );
    assert.equal(await db.inventoryBalance.count({ where: { productId: emptyProduct.id } }), 0);
    const changedProduct = await db.product.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        productCode: 'PROOF-DEACTIVATED-TRACKING',
        name: 'Changed stock definition',
        baseUnitId: unit.id,
        defaultPurchasePrice: 10,
        trackInventory: true,
      },
    });
    const changedCount = await counts.create(
      {
        companyId: company.id,
        branchId: branch.id,
        reason: 'Changed zero-book tracking',
        lines: [
          {
            productId: changedProduct.id,
            unitId: unit.id,
            countedQuantity: 5,
            expectedRevision: 0,
          },
        ],
      },
      user,
    );
    await approve(changedCount);
    // This metadata edit is legitimate while no on-hand/reserved/value exists.
    await db.product.update({ where: { id: changedProduct.id }, data: { trackInventory: false } });
    await assert.rejects(counts.post(changedCount.id, user), /stock definition changed/);
    assert.equal(
      (await db.stockAdjustment.findUniqueOrThrow({ where: { id: changedCount.id } })).status,
      'APPROVED',
    );
    assert.equal(await db.inventoryBalance.count({ where: { productId: changedProduct.id } }), 0);
    assert.equal(await db.inventoryMovement.count({ where: { referenceId: changedCount.id } }), 0);
    assert.equal(await db.journalEntry.count({ where: { referenceId: changedCount.id } }), 0);
    await movements.createMovement({
      ...tuple,
      productId: emptyProduct.id,
      quantity: 1,
      unitCost: 10,
      unitId: unit.id,
      movementType: 'PURCHASE_RECEIPT',
      movementDate: new Date(),
      createdById: actor.id,
    });
    await movements.createMovement({
      ...tuple,
      productId: emptyProduct.id,
      quantity: 1,
      unitId: unit.id,
      movementType: 'SALE_ISSUE',
      movementDate: new Date(),
      createdById: actor.id,
    });
    await assert.rejects(
      counts.create(
        {
          companyId: company.id,
          branchId: branch.id,
          reason: 'Stale identical quantity',
          lines: [
            {
              productId: emptyProduct.id,
              unitId: unit.id,
              countedQuantity: 0,
              systemQuantity: 0,
              expectedRevision: 0,
            },
          ],
        },
        user,
      ),
      /Stock changed/,
    );
    await assert.rejects(
      counts.submit(run.id, user, { expectedUpdatedAt: new Date('2000-01-01').toISOString() }),
      /changed/,
    );
    const submissions = await Promise.allSettled([
      counts.submit(run.id, user, { expectedUpdatedAt: run.updatedAt.toISOString() }),
      counts.submit(run.id, user, { expectedUpdatedAt: run.updatedAt.toISOString() }),
    ]);
    assert.equal(submissions.filter((result) => result.status === 'fulfilled').length, 1);
    await counts.approve(run.id, user);

    // A real concurrent receipt holds the SAME product lock while posting starts.
    // Observe PostgreSQL's blocked lock waiter before releasing the receipt.
    let enterReceipt;
    const receiptEntered = new Promise((resolve) => {
      enterReceipt = resolve;
    });
    let releaseReceipt;
    const receiptRelease = new Promise((resolve) => {
      releaseReceipt = resolve;
    });
    const concurrentReceipt = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${product.id} FOR UPDATE`;
        enterReceipt();
        await receiptRelease;
        return receive(3, tx);
      },
      { timeout: 30000 },
    );
    await receiptEntered;
    const concurrentPost = counts.post(run.id, user);
    let lockObserved = false;
    for (let attempt = 0; attempt < 100 && !lockObserved; attempt++) {
      const waiters =
        await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = ${database} AND wait_event_type = 'Lock' AND query LIKE '%products%'`;
      lockObserved = waiters[0].count > 0;
      if (!lockObserved) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    releaseReceipt();
    await Promise.all([concurrentReceipt, concurrentPost]);
    assert(lockObserved, 'Posting must wait for the concurrent product/stock lock');
    stock = await balance();
    assert.equal(stock.quantityOnHand.toString(), '13'); // 10 + 2 + 3 - frozen2
    assert.equal(stock.totalValue.toString(), '130');
    const ledger = await db.journalEntry.findFirstOrThrow({
      where: { referenceType: 'StockAdjustment', referenceId: run.id },
      include: { lines: true },
    });
    assert.equal(ledger.totalDebit.toString(), '20');
    assert.equal(
      ledger.lines.find((line) => line.accountId === inventoryAccount.id).credit.toString(),
      '20',
    );
    assert.equal(
      ledger.lines.find((line) => line.accountId === varianceAccount.id).debit.toString(),
      '20',
    );
    assert.equal(
      await db.inventoryMovement.count({
        where: { referenceType: 'StockAdjustment', referenceId: run.id },
      }),
      1,
    );
    assert.equal((await counts.create(frozenRequest, branchUser)).status, 'POSTED');

    // Duplicate posts cannot apply the frozen discrepancy twice.
    const duplicate = await counts.create(request(12, stock.physicalRevision), user);
    await approve(duplicate);
    const posts = await Promise.allSettled([
      counts.post(duplicate.id, user),
      counts.post(duplicate.id, user),
    ]);
    assert.equal(posts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal((await balance()).quantityOnHand.toString(), '12');
    assert.equal(
      await db.journalEntry.count({
        where: { referenceId: duplicate.id, referenceType: 'StockAdjustment' },
      }),
      1,
    );

    // Strict create/submit/post audit failures roll back the complete owner tx.
    const strict = audit.logStrictInTransaction.bind(audit);
    const countBeforeFailure = await db.stockAdjustment.count();
    audit.logStrictInTransaction = async (tx, input) => {
      if (input.action === 'STOCK_ADJUSTMENT_CREATE')
        throw new Error('forced strict create audit failure');
      return strict(tx, input);
    };
    await assert.rejects(
      counts.create(request(10, (await balance()).physicalRevision), user),
      /forced strict/,
    );
    assert.equal(await db.stockAdjustment.count(), countBeforeFailure);
    audit.logStrictInTransaction = strict;
    const auditFailure = await counts.create(request(11, (await balance()).physicalRevision), user);
    audit.logStrictInTransaction = async (tx, input) => {
      if (input.action === 'STOCK_ADJUSTMENT_SUBMIT')
        throw new Error('forced strict submit audit failure');
      return strict(tx, input);
    };
    await assert.rejects(counts.submit(auditFailure.id, user), /forced strict/);
    assert.equal(
      (await db.stockAdjustment.findUniqueOrThrow({ where: { id: auditFailure.id } })).status,
      'DRAFT',
    );
    audit.logStrictInTransaction = strict;
    await approve(auditFailure);
    let before = await snapshot(auditFailure.id);
    audit.logStrictInTransaction = async (tx, input) => {
      if (input.action === 'STOCK_ADJUSTMENT_POST')
        throw new Error('forced strict post audit failure');
      return strict(tx, input);
    };
    await assert.rejects(counts.post(auditFailure.id, user), /forced strict/);
    await assertRollback(auditFailure.id, before);
    audit.logStrictInTransaction = strict;
    await db.chartOfAccount.update({
      where: { id: varianceAccount.id },
      data: { isActive: false },
    });
    await assert.rejects(counts.post(auditFailure.id, user), /variance/);
    await assertRollback(auditFailure.id, before);
    await db.chartOfAccount.update({ where: { id: varianceAccount.id }, data: { isActive: true } });
    await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'CLOSED' } });
    await assert.rejects(counts.post(auditFailure.id, user), /not OPEN/);
    await assertRollback(auditFailure.id, before);
    await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });

    // Revert reads APPROVED + no movements, then pauses. Posting commits before
    // its stale state write resumes. Only the guarded claim may decide the race.
    const race = await counts.create(request(11, (await balance()).physicalRevision), user);
    await approve(race);
    let countRead;
    const countObserved = new Promise((resolve) => {
      countRead = resolve;
    });
    let resumeRevert;
    const resume = new Promise((resolve) => {
      resumeRevert = resolve;
    });
    const realTransaction = db.$transaction.bind(db);
    let paused = false;
    db.$transaction = (callback, options) =>
      realTransaction(async (tx) => {
        const movementDelegate = new Proxy(tx.inventoryMovement, {
          get(delegate, property) {
            if (property !== 'count') return delegate[property];
            return async (args) => {
              const value = await delegate.count(args);
              if (
                !paused &&
                args.where?.referenceId === race.id &&
                args.where?.referenceType === 'StockAdjustment'
              ) {
                paused = true;
                countRead();
                await resume;
              }
              return value;
            };
          },
        });
        return callback(
          new Proxy(tx, {
            get(client, property) {
              return property === 'inventoryMovement' ? movementDelegate : client[property];
            },
          }),
        );
      }, options);
    const reverting = counts.revertApproval(race.id, user).then(
      () => ({ ok: true }),
      (error) => ({ error }),
    );
    await countObserved;
    try {
      await counts.post(race.id, user);
    } finally {
      resumeRevert();
      db.$transaction = realTransaction;
    }
    const reverted = await reverting;
    assert(!reverted.ok && /changed/.test(reverted.error.message));
    assert.equal(
      (await db.stockAdjustment.findUniqueOrThrow({ where: { id: race.id } })).status,
      'POSTED',
    );
    assert.equal(
      await db.inventoryMovement.count({
        where: { referenceId: race.id, referenceType: 'StockAdjustment' },
      }),
      1,
    );
    await assert.rejects(counts.post(race.id, user), /APPROVED/);

    // Existing compensating negative book stock counted to zero carries no asset.
    await db.inventoryBalance.update({
      where: { id: stock.id },
      data: {
        quantityOnHand: -2,
        totalValue: 0,
        averageCost: 0,
        physicalRevision: { increment: 1 },
      },
    });
    await db.product.update({ where: { id: product.id }, data: { defaultPurchasePrice: null } });
    const zero = await counts.create(request(0, (await balance()).physicalRevision), user);
    await approve(zero);
    await counts.post(zero.id, user);
    stock = await balance();
    assert.equal(stock.quantityOnHand.toString(), '0');
    assert.equal(stock.totalValue.toString(), '0');
    assert.equal(stock.averageCost.toString(), '0');
    assert.equal(
      await db.journalEntry.count({
        where: { referenceId: zero.id, referenceType: 'StockAdjustment' },
      }),
      0,
    );
    console.log(
      'PASS inventory adjustment native PostgreSQL: capture/revision/absent tuple/base unit/scope/idempotency/CAS/frozen discrepancy/concurrent receipt/duplicate post/strict audit+GL rollback/count-to-zero',
    );
  } finally {
    if (db) await db.$disconnect();
    if (created) {
      await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    }
    await admin.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
