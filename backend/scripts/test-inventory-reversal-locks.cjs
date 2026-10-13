/* Real service contention proofs; every write is confined to a fresh loopback database. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
process.env.TAX_AUTO_APPLY = 'false';
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const { AuditLogsService } = require('../src/modules/audit-logs/audit-logs.service');
const { CompanyScopeService } = require('../src/common/services/company-scope.service');
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
const { TaxAutoApplyService } = require('../src/modules/tax-auto-apply/tax-auto-apply.service');
const { SalesOrdersService } = require('../src/modules/sales-orders/sales-orders.service');
const { CreditNotesService } = require('../src/modules/credit-notes/credit-notes.service');

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
async function bounded(promise, label, milliseconds = 4000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function conflict(result, text) {
  assert.equal(result.ok, false, 'The conflicting operation must fail');
  assert.equal(result.error.getStatus?.(), 409, result.error.stack);
  assert.match(result.error.message, text);
}

async function main() {
  const target = new URL(
    process.env.INVENTORY_REVERSAL_TEST_DATABASE_URL ??
      process.env.CUSTOMER_PERFORMANCE_TEST_DATABASE_URL ??
      process.env.DATABASE_URL,
  );
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname),
    'Only loopback PostgreSQL is allowed',
  );
  const database = `inventory_reversal_test_${randomUUID().replaceAll('-', '')}`;
  assert(/^inventory_reversal_test_[a-f0-9]{32}$/.test(database));
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
      { env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe', timeout: 120000 },
    );
    db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
    const group = await db.group.create({ data: { name: 'Reversal proof', code: 'REV-PROOF' } });
    const company = await db.company.create({
      data: { groupId: group.id, name: 'Reversal proof', code: 'REV-A' },
    });
    const division = await db.division.create({
      data: { companyId: company.id, name: 'Trading', code: 'REV-D', type: 'OTHER' },
    });
    const branch = await db.branch.create({
      data: { divisionId: division.id, name: 'Stock location', code: 'REV-LOC', type: 'BRANCH' },
    });
    const actor = await db.user.create({
      data: {
        email: 'reversal-proof@example.invalid',
        passwordHash: 'non-authenticating-fixture',
        fullName: 'Reversal proof operator',
      },
    });
    const user = {
      id: actor.id,
      email: actor.email,
      roles: [],
      roleScopes: ['COMPANY'],
      permissions: [],
      companyAccess: [{ companyId: company.id, accessLevel: 'MANAGE' }],
      divisionAccess: [],
      branchAccess: [],
    };
    const unit = await db.unitOfMeasure.create({
      data: { companyId: company.id, name: 'Each', symbol: 'ea', isBaseUnit: true },
    });
    const category = await db.productCategory.create({
      data: { companyId: company.id, name: 'Proof goods' },
    });
    const year = await db.fiscalYear.create({
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
        fiscalYearId: year.id,
        name: 'Proof period',
        startDate: year.startDate,
        endDate: year.endDate,
      },
    });
    await db.chartOfAccount.createMany({
      data: [
        {
          companyId: company.id,
          accountCode: '1100',
          accountName: 'Receivables',
          accountType: 'ASSET',
          accountSubType: 'ar_control',
        },
        {
          companyId: company.id,
          accountCode: '1300',
          accountName: 'Inventory',
          accountType: 'ASSET',
          accountSubType: 'inventory_asset',
        },
        {
          companyId: company.id,
          accountCode: '4000',
          accountName: 'Sales',
          accountType: 'INCOME',
          accountSubType: 'sales_revenue',
        },
        {
          companyId: company.id,
          accountCode: '5000',
          accountName: 'Cost of goods sold',
          accountType: 'EXPENSE',
          accountSubType: 'cost_of_goods_sold',
        },
      ],
    });
    const audit = new AuditLogsService(db);
    const companies = new CompanyScopeService(db);
    const resolver = new AccountResolverService(db);
    const codes = new EntityCodeGeneratorService(db);
    const profit = new ProfitService(db, companies, audit);
    const posting = new PostingEngineService(db, new AccountingControlService(db), resolver);
    const movements = new InventoryMovementsService(db, audit, codes, companies, profit);
    const sales = new SalesOrdersService(
      db,
      audit,
      movements,
      new TaxAutoApplyService(db, companies, audit),
      codes,
      companies,
      posting,
      resolver,
      profit,
    );
    const credits = new CreditNotesService(
      db,
      audit,
      companies,
      resolver,
      posting,
      codes,
      movements,
      profit,
    );

    // Instrument completed real writes, and optionally pause after the first real
    // journal write. No accounting or inventory implementation is stubbed.
    const realPost = posting.postLines.bind(posting);
    const realMovement = movements.createMovement.bind(movements);
    const effects = [];
    const attempts = [];
    let gate = null;
    posting.postLines = async (input, tx) => {
      attempts.push({ kind: 'journal', referenceId: input.referenceId });
      const result = await realPost(input, tx);
      effects.push({
        kind: 'journal',
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      });
      if (gate?.referenceId === input.referenceId) {
        const active = gate;
        gate = null;
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
        active.entered.resolve(pid);
        await active.release.promise;
      }
      return result;
    };
    movements.createMovement = async (input) => {
      attempts.push({ kind: 'stock', referenceId: input.referenceId });
      const result = await realMovement(input);
      effects.push({
        kind: 'stock',
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      });
      return result;
    };
    const pauseJournal = (referenceId) => {
      const barrier = { referenceId, entered: deferred(), release: deferred() };
      gate = barrier;
      return barrier;
    };
    const balance = (fixture) =>
      db.inventoryBalance.findUniqueOrThrow({
        where: {
          companyId_productId_branchId: {
            companyId: company.id,
            productId: fixture.product.id,
            branchId: branch.id,
          },
        },
      });
    const journals = (type, id) =>
      db.journalEntry.findMany({
        where: { referenceType: type, referenceId: id },
        include: { lines: { orderBy: { id: 'asc' } } },
        orderBy: { id: 'asc' },
      });
    const snapshot = async (fixture) => ({
      sale: await db.salesOrder.findUniqueOrThrow({
        where: { id: fixture.sale.id },
        include: { lines: { orderBy: { id: 'asc' } } },
      }),
      credit: await db.creditNote.findUniqueOrThrow({ where: { id: fixture.credit.id } }),
      receivable: await db.receivable.findUniqueOrThrow({
        where: { id: fixture.sale.receivableId },
      }),
      customer: await db.customer.findUniqueOrThrow({ where: { id: fixture.customer.id } }),
      stock: await balance(fixture),
      movements: await db.inventoryMovement.findMany({
        where: { productId: fixture.product.id },
        orderBy: { id: 'asc' },
      }),
      saleJournals: await journals('SalesOrder', fixture.sale.id),
      creditJournals: await journals('CreditNote', fixture.credit.id),
      audits: await db.auditLog.findMany({
        where: { companyId: company.id },
        orderBy: { id: 'asc' },
      }),
    });
    let fixtureNumber = 0;
    async function fixture({ receivableOnlyLink = false } = {}) {
      fixtureNumber += 1;
      const product = await db.product.create({
        data: {
          companyId: company.id,
          categoryId: category.id,
          productCode: `REV-P${fixtureNumber}`,
          name: `Proof goods ${fixtureNumber}`,
          baseUnitId: unit.id,
          defaultPurchasePrice: 10,
          trackInventory: true,
          isTaxable: false,
        },
      });
      const customer = await db.customer.create({
        data: {
          companyId: company.id,
          divisionId: division.id,
          branchId: branch.id,
          customerCode: `REV-C${fixtureNumber}`,
          name: 'Proof customer',
        },
      });
      await movements.createMovement({
        companyId: company.id,
        divisionId: division.id,
        branchId: branch.id,
        productId: product.id,
        quantity: 10,
        unitId: unit.id,
        unitCost: 10,
        movementType: 'PURCHASE_RECEIPT',
        movementDate: new Date(),
        createdById: actor.id,
      });
      const draft = await sales.create(
        {
          companyId: company.id,
          divisionId: division.id,
          branchId: branch.id,
          customerId: customer.id,
          salesType: 'CREDIT_SALE',
          paymentMethod: 'CREDIT',
          currency: 'TZS',
          orderDate: new Date().toISOString(),
          lines: [
            {
              productId: product.id,
              unitId: unit.id,
              quantity: 4,
              unitPrice: 20,
              taxAmount: 0,
              taxManual: true,
            },
          ],
        },
        user,
      );
      const sale = await sales.confirm(draft.id, user);
      assert.equal(sale.status, 'CONFIRMED');
      assert(
        sale.receivableId && sale.journalEntryId,
        'Actual confirmation must create its linked receivable and journal',
      );
      const credit = await credits.create(
        {
          companyId: company.id,
          divisionId: division.id,
          branchId: branch.id,
          customerId: customer.id,
          ...(receivableOnlyLink ? {} : { salesOrderId: sale.id }),
          receivableId: sale.receivableId,
          currency: 'TZS',
          issueDate: new Date().toISOString(),
          reason: 'Returned goods proof',
          lines: [
            {
              productId: product.id,
              unitId: unit.id,
              description: 'Returned goods',
              quantity: 2,
              unitPrice: 20,
              returnedQuantity: 2,
              restockUnitCost: 10,
            },
          ],
        },
        user,
      );
      const result = { product, customer, sale, credit };
      assert.equal((await balance(result)).quantityOnHand.toString(), '6');
      assert.equal((await balance(result)).totalValue.toString(), '60');
      assert.equal(
        (
          await db.customer.findUniqueOrThrow({ where: { id: customer.id } })
        ).currentBalance.toString(),
        '80',
      );
      return result;
    }
    async function observeSalesOrderWait(holderPid) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiters = await db.$queryRaw`
          SELECT query FROM pg_stat_activity
          WHERE datname = ${database} AND wait_event_type = 'Lock'
            AND ${holderPid}::int = ANY(pg_blocking_pids(pid))
        `;
        if (waiters.length) {
          assert(
            waiters.some(({ query }) => /sales_orders/.test(query)),
            'The competing operation must wait on the sales order document',
          );
          assert(
            waiters.every(({ query }) => !/FROM products/i.test(query)),
            'The document waiter must not acquire product locks first',
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('No deterministic sales-order lock waiter observed');
    }
    async function busyReceivable(fixture, operation) {
      const before = await snapshot(fixture);
      const entered = deferred();
      const release = deferred();
      const holder = settle(
        db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM receivables WHERE id = ${fixture.sale.receivableId} FOR UPDATE`;
            // Write-off can hold the receivable and the posting period before it
            // synchronizes the sale. A late-only R guard would wait on this period.
            await tx.$queryRaw`SELECT id FROM accounting_periods WHERE id = ${period.id} FOR UPDATE`;
            entered.resolve();
            await release.promise;
          },
          { timeout: 20000 },
        ),
      );
      let pending;
      const start = effects.length;
      const attemptStart = attempts.length;
      try {
        await bounded(entered.promise, 'Receivable lock acquisition');
        pending = settle(operation());
        const result = await bounded(
          pending,
          'NOWAIT conflict while the receivable remains locked',
        );
        conflict(result, /linked receivable is being updated/i);
        assert.deepEqual(
          await snapshot(fixture),
          before,
          'A busy receivable must preserve document state, original journals, stock, balances and audit rows',
        );
        assert.deepEqual(
          effects.slice(start),
          [],
          'A busy receivable must not complete financial or stock effects',
        );
        assert.deepEqual(
          attempts.slice(attemptStart),
          [],
          'A busy receivable must reject before any financial or stock posting attempt',
        );
      } finally {
        release.resolve();
        const released = await holder;
        assert.equal(released.ok, true, released.error?.stack);
        if (pending) await pending;
      }
    }

    // A real cancellation holds the sale and writes its reversal before commit.
    // The credit note carries only the receivable link, exercising derived SO locking.
    const cancelled = await fixture({ receivableOnlyLink: true });
    let barrier = pauseJournal(cancelled.sale.id);
    let winning = settle(sales.cancel(cancelled.sale.id, user));
    let losing;
    try {
      const pid = await bounded(barrier.entered.promise, 'Cancellation posting barrier');
      losing = settle(credits.issue(cancelled.credit.id, user));
      await observeSalesOrderWait(pid);
    } finally {
      barrier.release.resolve();
    }
    let winner = await winning;
    assert.equal(winner.ok, true, winner.error?.stack);
    conflict(await losing, /CANCELLED receivable/i);
    let state = await snapshot(cancelled);
    assert.equal(state.sale.status, 'CANCELLED');
    assert.equal(state.receivable.outstandingAmount.toString(), '0');
    assert.equal(state.customer.currentBalance.toString(), '0');
    assert.equal(state.credit.status, 'DRAFT');
    assert.equal(state.stock.quantityOnHand.toString(), '10');
    assert.equal(state.stock.totalValue.toString(), '100');
    assert.equal(state.saleJournals.length, 2);
    assert.equal(
      state.saleJournals.filter((entry) => entry.reversalOfId === cancelled.sale.journalEntryId)
        .length,
      1,
    );
    assert.equal(state.creditJournals.length, 0);
    assert.equal(
      state.audits.filter(
        (row) => row.entityId === cancelled.credit.id && row.action === 'CREDIT_NOTE_ISSUE',
      ).length,
      0,
    );
    assert.equal(state.movements.filter((move) => move.referenceType === 'CreditNote').length, 0);
    assert.equal(
      state.movements.filter(
        (move) => move.referenceType === 'SalesOrder' && move.movementType === 'SALES_RETURN',
      ).length,
      1,
    );
    console.log(
      'PASS actual cancellation wins: receivable-linked credit waits on sale then rejects without a second reversal',
    );

    const issued = await fixture();
    barrier = pauseJournal(issued.credit.id);
    winning = settle(credits.issue(issued.credit.id, user));
    try {
      const pid = await bounded(barrier.entered.promise, 'Credit issue posting barrier');
      losing = settle(sales.cancel(issued.sale.id, user));
      await observeSalesOrderWait(pid);
    } finally {
      barrier.release.resolve();
    }
    winner = await winning;
    assert.equal(winner.ok, true, winner.error?.stack);
    conflict(await losing, /issued credit note/i);
    state = await snapshot(issued);
    assert.equal(state.sale.status, 'CONFIRMED');
    assert.equal(state.receivable.outstandingAmount.toString(), '40');
    assert.equal(state.customer.currentBalance.toString(), '40');
    assert.equal(state.credit.status, 'ISSUED');
    assert.equal(state.credit.appliedAmount.toString(), '40');
    assert.equal(state.stock.quantityOnHand.toString(), '8');
    assert.equal(state.stock.totalValue.toString(), '80');
    assert.equal(state.saleJournals.length, 1);
    assert.equal(state.saleJournals[0].status, 'POSTED');
    assert.equal(
      state.audits.filter(
        (row) => row.entityId === issued.sale.id && row.action === 'SALES_ORDER_CANCEL',
      ).length,
      0,
    );
    assert.equal(state.creditJournals.length, 2);
    assert.equal(
      state.movements.filter(
        (move) => move.referenceType === 'CreditNote' && move.movementType === 'SALES_RETURN',
      ).length,
      1,
    );
    assert.equal(
      state.movements.filter(
        (move) => move.referenceType === 'SalesOrder' && move.movementType === 'SALES_RETURN',
      ).length,
      0,
    );
    console.log(
      'PASS actual credit issue wins: cancellation waits on sale, reloads issued note and preserves single stock/GL reversal',
    );

    const busyIssue = await fixture();
    await busyReceivable(busyIssue, () => credits.issue(busyIssue.credit.id, user));
    console.log(
      'PASS busy receivable credit issue: prompt 409 before posting; unchanged documents/GL/stock/party/audits',
    );
    const busyCancel = await fixture();
    await busyReceivable(busyCancel, () => sales.cancel(busyCancel.sale.id, user));
    console.log(
      'PASS busy receivable cancellation: prompt 409 before posting; unchanged documents/GL/stock/party/audits',
    );
    await busyReceivable(issued, () =>
      credits.void(issued.credit.id, { reason: 'Contention proof' }, user),
    );
    console.log(
      'PASS busy receivable credit void: prompt 409 before posting; retained issued note/original journals/stock/party/audits',
    );
  } finally {
    if (db) await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
