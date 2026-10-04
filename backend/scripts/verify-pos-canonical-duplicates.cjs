const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { eatDay, lockPosSalePosting } = require('../dist/common/services/pos-sale-duplicates');

/** Extends only the isolated API/database proof using its synthetic company and actors. */
module.exports.verifyPosCanonicalDuplicates = async ({ db, check, fixture: f, call }) => {
  assert.ok(
    f.company.code.startsWith('POS-'),
    'Duplicate proof requires the synthetic POS fixture',
  );
  const api = 'http://127.0.0.1:28001/api/v1';
  const scope = { companyId: f.company.id, divisionId: f.division.id, branchId: f.branch.id };
  async function request(token, method, route, body) {
    const response = await fetch(api + route, {
      method,
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(90_000),
    });
    const parsed = await response.json();
    return { status: response.status, data: parsed.data ?? parsed };
  }
  const concurrentRequest = (...args) =>
    request(...args).then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
  async function concurrentResult(pending) {
    const outcome = await pending;
    if (outcome.error) throw outcome.error;
    return outcome.result;
  }
  async function productFixture() {
    const product = await db.product.create({
      data: {
        companyId: f.company.id,
        productCode: 'DUP-' + randomUUID(),
        name: 'Synthetic canonical duplicate stock item',
        categoryId: f.product.categoryId,
        baseUnitId: f.unit.id,
        defaultPurchasePrice: 40,
        defaultSellingPrice: 100,
        retailPrice: 100,
        trackInventory: true,
        isTaxable: false,
      },
    });
    await db.inventoryBalance.create({
      data: {
        ...scope,
        productId: product.id,
        quantityOnHand: 100,
        averageCost: 40,
        totalValue: 4000,
      },
    });
    return product;
  }
  const officePayload = (product, quantity, key = randomUUID()) => ({
    ...scope,
    customerId: f.customer.id,
    salesType: 'CASH_SALE',
    orderDate: eatDay(new Date()),
    currency: 'TZS',
    paymentMethod: 'CASH',
    cashAccountId: f.cash.id,
    idempotencyKey: key,
    lines: [
      {
        productId: product.id,
        quantity,
        unitId: f.unit.id,
        unitPrice: 100,
        discountAmount: 0,
        taxAmount: 0,
      },
    ],
  });
  const draftPayload = (product, quantity) => {
    const capturedAt = new Date().toISOString();
    return {
      ...scope,
      requestId: randomUUID(),
      kind: 'SALE',
      businessDate: eatDay(capturedAt),
      capturedAt,
      payload: {
        customerId: f.customer.id,
        paymentMethod: 'CASH',
        cashAccountId: f.cash.id,
        lines: [{ productId: product.id, quantity }],
        expectedTotal: quantity * 100,
      },
    };
  };
  async function effects(product) {
    const balance = await db.inventoryBalance.findUniqueOrThrow({
      where: {
        companyId_productId_branchId: {
          companyId: f.company.id,
          productId: product.id,
          branchId: f.branch.id,
        },
      },
    });
    return {
      onHand: balance.quantityOnHand.toNumber(),
      reserved: balance.quantityReserved.toNumber(),
      money: (
        await db.cashAccount.findUniqueOrThrow({ where: { id: f.cash.id } })
      ).currentBalance.toNumber(),
      sales: await db.salesOrder.count({
        where: {
          companyId: f.company.id,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          lines: { some: { productId: product.id } },
        },
      }),
      movements: await db.inventoryMovement.count({
        where: { companyId: f.company.id, productId: product.id },
      }),
      journals: await db.journalEntry.count({ where: { companyId: f.company.id } }),
    };
  }
  async function waitForBlocked(pid, count, description) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const rows = await db.$queryRaw(Prisma.sql`
        SELECT pid FROM pg_stat_activity
        WHERE wait_event_type='Lock' AND ${pid} = ANY(pg_blocking_pids(pid))
      `);
      if (rows.length >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(description + ' must be observed waiting on a real database lock');
  }
  async function blockingTransaction(lock, work) {
    let unlock;
    let announce;
    let failed;
    const hold = new Promise((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise((resolve, reject) => {
      announce = resolve;
      failed = reject;
    });
    const transaction = db
      .$transaction(
        async (tx) => {
          await lock(tx);
          const [{ pid }] = await tx.$queryRaw(Prisma.sql`SELECT pg_backend_pid() AS pid`);
          announce({ tx, pid });
          await hold;
        },
        { timeout: 30_000 },
      )
      .catch((error) => {
        failed(error);
        throw error;
      });
    transaction.catch(() => {});
    try {
      return await work(await ready);
    } finally {
      unlock();
      await transaction;
    }
  }

  await check(
    'An already posted office sale is rechecked and a genuine POS repeat requires explicit review',
    async () => {
      const product = await productFixture();
      const before = await effects(product);
      const office = await call(
        f.admin.token,
        'POST',
        '/sales-orders/quick-sale',
        officePayload(product, 4),
      );
      assert.equal(office.status, 'CONFIRMED');
      const draft = await call(f.admin.token, 'POST', '/pos-drafts', draftPayload(product, 4));
      assert.equal(draft.status, 'NEEDS_ATTENTION');
      await call(
        f.admin.token,
        'POST',
        `/pos-drafts/${draft.id}/direct-post`,
        { revision: draft.revision },
        409,
      );
      const detail = await call(f.admin.token, 'GET', `/pos-drafts/${draft.id}`, undefined, 200);
      assert.equal(detail.pendingMoney, 400);
      assert.deepEqual(
        detail.duplicateCandidates.map((candidate) => candidate.id),
        [office.id],
      );
      const afterBlock = await effects(product);
      assert.equal(afterBlock.onHand, before.onHand - 4);
      assert.equal(afterBlock.money, before.money + 400);
      assert.equal(afterBlock.sales, before.sales + 1);
      const posted = await call(f.admin.token, 'POST', `/pos-drafts/${draft.id}/direct-post`, {
        revision: detail.revision,
        duplicateReason: 'The customer made a separate genuine purchase',
        reviewedCandidateIds: [office.id],
      });
      assert.equal(posted.status, 'POSTED');
      const after = await effects(product);
      assert.equal(after.onHand, before.onHand - 8);
      assert.equal(after.money, before.money + 800);
      assert.equal(after.sales, before.sales + 2);
      assert.equal(after.movements, before.movements + 2);
      assert.equal(after.journals, before.journals + 2);
    },
  );

  await check(
    'Concurrent office confirmation and POS posting serialize and cannot both post a matching capture',
    async () => {
      const product = await productFixture();
      const draft = await call(f.admin.token, 'POST', '/pos-drafts', draftPayload(product, 5));
      const before = await effects(product);
      const officeBody = officePayload(product, 5);
      let office;
      let pos;
      await blockingTransaction(
        (tx) => lockPosSalePosting(tx, f.company.id),
        async ({ pid }) => {
          office = concurrentRequest(f.admin.token, 'POST', '/sales-orders/quick-sale', officeBody);
          await waitForBlocked(pid, 1, 'Office confirmation');
          pos = concurrentRequest(f.admin.token, 'POST', `/pos-drafts/${draft.id}/direct-post`, {
            revision: draft.revision,
          });
          await waitForBlocked(pid, 2, 'Concurrent office and POS confirmation');
        },
      );
      const results = await Promise.all([concurrentResult(office), concurrentResult(pos)]);
      assert.equal(
        results[0].status,
        409,
        'Office confirmation must leave its canonical draft for review',
      );
      assert.equal(results[1].status, 201, 'Owning POS approval completes once');
      assert.equal(results[1].data.status, 'POSTED');
      const officeRecord = await db.salesOrder.findFirstOrThrow({
        where: { companyId: f.company.id, idempotencyKey: officeBody.idempotencyKey },
      });
      assert.equal(officeRecord.status, 'DRAFT');
      const after = await effects(product);
      assert.equal(after.onHand, before.onHand - 5);
      assert.equal(after.money, before.money + 500);
      assert.equal(after.sales, before.sales + 1);
      assert.equal(after.movements, before.movements + 1);
      assert.equal(after.journals, before.journals + 1);
      assert.equal(
        (await db.posDraft.findUniqueOrThrow({ where: { id: draft.id } })).pendingMoney.toNumber(),
        0,
      );
    },
  );

  await check(
    'Office confirmation reloads a concurrently edited row before its locked duplicate check',
    async () => {
      const product = await productFixture();
      const original = officePayload(product, 2);
      const office = await call(f.admin.token, 'POST', '/sales-orders', original);
      const draft = await call(f.admin.token, 'POST', '/pos-drafts', draftPayload(product, 5));
      const before = await effects(product);
      let confirmation;
      await blockingTransaction(
        (tx) =>
          tx.$queryRaw(Prisma.sql`SELECT id FROM sales_orders WHERE id=${office.id} FOR UPDATE`),
        async ({ tx, pid }) => {
          confirmation = concurrentRequest(
            f.admin.token,
            'PATCH',
            `/sales-orders/${office.id}/confirm`,
          );
          await waitForBlocked(pid, 1, 'Office confirmation after its earlier snapshot');
          await tx.salesOrderLine.updateMany({
            where: { salesOrderId: office.id },
            data: { quantity: 5, lineTotal: 500 },
          });
          await tx.salesOrder.update({
            where: { id: office.id },
            data: { subtotal: 500, totalAmount: 500, outstandingAmount: 500 },
          });
        },
      );
      assert.equal(
        (await concurrentResult(confirmation)).status,
        409,
        'Current row now matches the captured POS transaction',
      );
      assert.deepEqual(await effects(product), before);
      const officeRecord = await db.salesOrder.findUniqueOrThrow({ where: { id: office.id } });
      assert.equal(officeRecord.status, 'DRAFT');
      assert.equal(officeRecord.totalAmount.toNumber(), 500);
      assert.equal(
        (await db.posDraft.findUniqueOrThrow({ where: { id: draft.id } })).pendingMoney.toNumber(),
        500,
      );
    },
  );
};
