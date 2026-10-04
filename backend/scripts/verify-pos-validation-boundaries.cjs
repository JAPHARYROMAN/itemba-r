const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');

/** Business-boundary acceptance in the caller's isolated API/database proof. */
module.exports.verifyPosValidationBoundaries = async ({ db, check, fixture: f, call }) => {
  const scope = { companyId: f.company.id, divisionId: f.division.id, branchId: f.branch.id };
  const number = (value) => Number(value);
  const envelope = (payload) => {
    const capturedAt = new Date().toISOString();
    return {
      ...scope,
      requestId: randomUUID(),
      kind: 'SALE',
      businessDate: new Date(Date.parse(capturedAt) + 3 * 3_600_000).toISOString().slice(0, 10),
      capturedAt,
      payload,
    };
  };
  async function productFixture(label, quantity = 10) {
    const product = await db.product.create({
      data: {
        companyId: f.company.id,
        productCode: randomUUID(),
        name: 'Synthetic POS boundary ' + label,
        categoryId: f.product.categoryId,
        baseUnitId: f.unit.id,
        defaultPurchasePrice: 40,
        defaultSellingPrice: 100,
        retailPrice: 100,
        trackInventory: true,
        isTaxable: false,
      },
    });
    const balance = await db.inventoryBalance.create({
      data: {
        ...scope,
        productId: product.id,
        quantityOnHand: quantity,
        quantityReserved: 0,
        averageCost: 40,
        totalValue: quantity * 40,
      },
    });
    return { product, balance };
  }
  const sale = (productId, quantity) => ({
    customerId: f.customer.id,
    paymentMethod: 'CASH',
    cashAccountId: f.cash.id,
    expectedTotal: quantity * 100,
    lines: [{ productId, quantity }],
  });
  async function canonicalSnapshot(productId) {
    const [orders, payments, journals, movements, cash, balance] = await Promise.all([
      db.salesOrder.count({
        where: { companyId: f.company.id, status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] } },
      }),
      db.customerPayment.count({ where: { companyId: f.company.id } }),
      db.journalEntry.count({ where: { companyId: f.company.id } }),
      db.inventoryMovement.count({ where: { companyId: f.company.id } }),
      db.cashAccount.findUniqueOrThrow({ where: { id: f.cash.id } }),
      db.inventoryBalance.findUniqueOrThrow({
        where: {
          companyId_productId_branchId: {
            companyId: f.company.id,
            branchId: f.branch.id,
            productId,
          },
        },
      }),
    ]);
    return {
      orders,
      payments,
      journals,
      movements,
      cash: cash.currentBalance.toString(),
      onHand: balance.quantityOnHand.toString(),
      reserved: balance.quantityReserved.toString(),
      physicalRevision: balance.physicalRevision,
      value: balance.totalValue.toString(),
    };
  }

  await check(
    'Changed canonical selling price blocks posting while preserving the captured money and sale',
    async () => {
      const { product } = await productFixture('price');
      const capture = await call(
        f.admin.token,
        'POST',
        '/pos-drafts',
        envelope(sale(product.id, 2)),
      );
      const before = await canonicalSnapshot(product.id);
      await db.product.update({
        where: { id: product.id },
        data: { retailPrice: 125, defaultSellingPrice: 125 },
      });
      try {
        await call(
          f.admin.token,
          'POST',
          `/pos-drafts/${capture.id}/direct-post`,
          { revision: capture.revision },
          409,
        );
        const blocked = await db.posDraft.findUniqueOrThrow({
          where: { id: capture.id },
          include: { decisions: true },
        });
        assert.equal(blocked.status, 'NEEDS_ATTENTION');
        assert.match(blocked.blockingReason, /price.*changed|selling price changed/i);
        assert.equal(number(blocked.amount), 200);
        assert.equal(number(blocked.pendingMoney), 200);
        assert.equal(
          blocked.payload.lines[0].unitPrice,
          100,
          'Master price changes cannot rewrite already collected money',
        );
        assert.equal(blocked.payload.paymentMethod, 'CASH');
        assert.equal(blocked.decisions.at(-1).action, 'POST_BLOCKED');
        assert.deepEqual(await canonicalSnapshot(product.id), before);
      } finally {
        await db.product.update({
          where: { id: product.id },
          data: { retailPrice: 100, defaultSellingPrice: 100 },
        });
      }
    },
  );

  await check(
    'Closing an accounting period after capture blocks approval without canonical stock or financial effects',
    async () => {
      const { product } = await productFixture('period');
      const input = envelope(sale(product.id, 3));
      const capture = await call(f.admin.token, 'POST', '/pos-drafts', input);
      const before = await canonicalSnapshot(product.id);
      const date = new Date(input.businessDate + 'T12:00:00+03:00');
      const periods = await db.accountingPeriod.findMany({
        where: { companyId: f.company.id, startDate: { lte: date }, endDate: { gte: date } },
      });
      assert.ok(periods.length, 'The fixture must have a matching open accounting period');
      try {
        await db.accountingPeriod.updateMany({
          where: { id: { in: periods.map((period) => period.id) } },
          data: { status: 'CLOSED' },
        });
        await call(
          f.reviewer.token,
          'POST',
          `/pos-drafts/${capture.id}/approve`,
          { revision: capture.revision },
          400,
        );
        const blocked = await db.posDraft.findUniqueOrThrow({
          where: { id: capture.id },
          include: { decisions: true },
        });
        assert.equal(blocked.status, 'NEEDS_ATTENTION');
        assert.match(blocked.blockingReason, /period.*(open|closed|locked)/i);
        assert.equal(number(blocked.amount), 300);
        assert.equal(number(blocked.pendingMoney), 300);
        assert.equal(blocked.decisions.at(-1).action, 'POST_BLOCKED');
        assert.equal(blocked.postedEntityId, null);
        assert.deepEqual(await canonicalSnapshot(product.id), before);
      } finally {
        for (const period of periods)
          await db.accountingPeriod.update({
            where: { id: period.id },
            data: { status: period.status },
          });
      }
    },
  );

  await check(
    'Ordinary office sales cannot consume an approved POS hold; unreserved stock and the held sale post separately',
    async () => {
      const { product } = await productFixture('reserved stock');
      const setup = await db.mobilePosBranchSetup.findUniqueOrThrow({
        where: { branchId: f.branch.id },
      });
      const invite = await call(f.admin.token, 'POST', '/mobile-pos-onboarding/invites', {
        branchSetupId: setup.id,
      });
      const claim = await call(null, 'POST', '/mobile-pos-auth/invite/' + invite.token, {
        name: 'Synthetic reservation cashier ' + randomUUID().slice(0, 8),
        role: 'CASHIER',
      });
      await call(
        f.admin.token,
        'POST',
        `/mobile-pos-onboarding/enrollments/${claim.enrollmentId}/approve`,
        { role: 'CASHIER' },
      );
      const session = await call(null, 'POST', '/mobile-pos-auth/setup', {
        claimToken: claim.claimToken,
        deviceSecret: randomBytes(32).toString('hex'),
        pin: '678901',
      });
      try {
        const capture = await call(
          session.accessToken,
          'POST',
          '/pos-drafts',
          envelope(sale(product.id, 4)),
        );
        const approved = await call(f.admin.token, 'POST', `/pos-drafts/${capture.id}/approve`, {
          revision: capture.revision,
        });
        assert.equal(approved.status, 'AWAITING_STOCKIST');
        const hold = await db.posDraftReservation.findFirstOrThrow({
          where: { draftId: capture.id, releasedAt: null },
        });
        assert.equal(number(hold.quantity), 4);
        assert.ok(hold.expiresAt.getTime() > Date.now());
        const before = await canonicalSnapshot(product.id);
        assert.equal(number(before.onHand), 10);
        assert.equal(number(before.reserved), 4);
        const officeSale = (quantity) => ({
          ...scope,
          customerId: f.customer.id,
          salesType: 'CASH_SALE',
          orderDate: envelope({}).businessDate,
          currency: 'TZS',
          paymentMethod: 'CASH',
          cashAccountId: f.cash.id,
          idempotencyKey: randomUUID(),
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
        await Promise.all([
          call(f.admin.token, 'POST', '/sales-orders/quick-sale', officeSale(7), 400),
          call(f.admin.token, 'POST', '/sales-orders/quick-sale', officeSale(7), 400),
        ]);
        assert.deepEqual(
          await canonicalSnapshot(product.id),
          before,
          'Rejected canonical issues cannot confirm a sale or change cash, journals or movements',
        );
        assert.equal(
          (await db.posDraftReservation.findUniqueOrThrow({ where: { id: hold.id } })).releasedAt,
          null,
        );
        const office = await call(f.admin.token, 'POST', '/sales-orders/quick-sale', officeSale(6));
        assert.equal(number(office.totalAmount), 600);
        const remaining = await canonicalSnapshot(product.id);
        assert.equal(number(remaining.onHand), 4);
        assert.equal(
          number(remaining.reserved),
          4,
          'The office sale consumes only unreserved units',
        );
        const prepared = await call(f.admin.token, 'POST', `/pos-drafts/${capture.id}/prepare`, {
          revision: approved.revision,
        });
        const posted = await call(f.reviewer.token, 'POST', `/pos-drafts/${capture.id}/approve`, {
          revision: prepared.revision,
        });
        assert.equal(posted.status, 'POSTED');
        const after = await canonicalSnapshot(product.id);
        assert.equal(number(after.onHand), 0);
        assert.equal(number(after.reserved), 0);
        assert.equal(after.orders, before.orders + 2);
        assert.equal(after.movements, before.movements + 2);
        assert.equal(number(after.cash) - number(before.cash), 1000);
        assert.ok(
          (await db.posDraftReservation.findUniqueOrThrow({ where: { id: hold.id } })).releasedAt,
        );
        assert.equal(
          number((await db.posDraft.findUniqueOrThrow({ where: { id: capture.id } })).pendingMoney),
          0,
        );
      } finally {
        await call(
          f.admin.token,
          'POST',
          `/mobile-pos-onboarding/enrollments/${claim.enrollmentId}/revoke`,
          { reason: 'Synthetic reservation proof completed' },
        );
      }
    },
  );
};
