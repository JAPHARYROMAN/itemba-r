const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');

/** Real API/DB coverage for distinguishing repeated stockist captures from cashier continuations. */
module.exports.verifyPosReviewedRepeat = async ({ db, check, fixture: f, call }) => {
  const scope = { companyId: f.company.id, divisionId: f.division.id, branchId: f.branch.id };
  const name = randomBytes(6).toString('hex');
  const setup = await call(f.admin.token, 'POST', '/mobile-pos-onboarding/branch-setups', {
    ...scope,
    generalCustomerId: f.customer.id,
    paymentMappings: [{ paymentMethod: 'CASH', cashAccountId: f.cash.id }],
    approvalRequired: true,
  });
  const invite = await call(f.admin.token, 'POST', '/mobile-pos-onboarding/invites', {
    branchSetupId: setup.id,
  });
  async function actor(role, inviteToken = invite.token) {
    const registration = await call(null, 'POST', '/mobile-pos-auth/invite/' + inviteToken, {
      name: 'Synthetic repeat ' + role + ' ' + name,
      role,
    });
    await call(
      f.admin.token,
      'POST',
      `/mobile-pos-onboarding/enrollments/${registration.enrollmentId}/approve`,
      { role },
    );
    const session = await call(null, 'POST', '/mobile-pos-auth/setup', {
      claimToken: registration.claimToken,
      deviceSecret: randomBytes(32).toString('hex'),
      pin: role === 'CASHIER' ? '123456' : '234567',
    });
    return session;
  }
  const cashier = await actor('CASHIER');
  const stockist = await actor('STOCKIST');
  async function productFixture(label, quantity) {
    const product = await db.product.create({
      data: {
        companyId: f.company.id,
        productCode: randomUUID(),
        name: 'Synthetic reviewed repeat ' + label,
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
        quantityOnHand: quantity,
        quantityReserved: 0,
        averageCost: 40,
        totalValue: quantity * 40,
      },
    });
    return product;
  }
  const envelope = (productId, quantity) => {
    const capturedAt = new Date().toISOString();
    return {
      ...scope,
      requestId: randomUUID(),
      kind: 'SALE',
      capturedAt,
      businessDate: new Date(Date.parse(capturedAt) + 3 * 3_600_000).toISOString().slice(0, 10),
      payload: {
        customerId: f.customer.id,
        paymentMethod: 'CASH',
        expectedTotal: quantity * 100,
        lines: [{ productId, quantity }],
      },
    };
  };
  const balance = (productId) =>
    db.inventoryBalance.findUniqueOrThrow({
      where: {
        companyId_productId_branchId: { companyId: f.company.id, branchId: f.branch.id, productId },
      },
    });
  const cash = async () =>
    Number((await db.cashAccount.findUniqueOrThrow({ where: { id: f.cash.id } })).currentBalance);
  async function snapshot(productId) {
    const b = await balance(productId);
    return {
      stock: b.quantityOnHand.toString(),
      reserved: b.quantityReserved.toString(),
      value: b.totalValue.toString(),
      physicalRevision: b.physicalRevision,
      cash: await cash(),
      sales: await db.salesOrder.count({ where: { companyId: f.company.id } }),
      journals: await db.journalEntry.count({ where: { companyId: f.company.id } }),
      movements: await db.inventoryMovement.count({ where: { companyId: f.company.id } }),
      payments: await db.customerPayment.count({ where: { companyId: f.company.id } }),
    };
  }
  const reviewerBody = async (id) => {
    const detail = await call(f.admin.token, 'GET', '/pos-drafts/' + id);
    return {
      revision: detail.revision,
      duplicateReason:
        'Customer made a separate genuine second purchase with separately collected cash',
      reviewedCandidateIds: detail.duplicateCandidates.map((candidate) => candidate.id),
    };
  };
  async function finishCashier(draft, approved) {
    const prepared = await call(stockist.accessToken, 'POST', `/pos-drafts/${draft.id}/prepare`, {
      revision: approved.revision,
    });
    const detail = await call(f.admin.token, 'GET', '/pos-drafts/' + draft.id);
    return call(f.reviewer.token, 'POST', `/pos-drafts/${draft.id}/approve`, {
      revision: prepared.revision,
      ...(detail.duplicateCandidates.length
        ? {
            duplicateReason:
              'The approved cashier purchase and the separately collected second purchase are distinct',
            reviewedCandidateIds: detail.duplicateCandidates.map((candidate) => candidate.id),
          }
        : {}),
    });
  }

  await check(
    'An exact stockist match to a posted cashier sale can become one explicitly reviewed genuine repeat',
    async () => {
      const product = await productFixture('posted cashier', 10);
      const beforeMoney = await cash();
      const first = await call(cashier.accessToken, 'POST', '/pos-drafts', envelope(product.id, 2));
      const approved = await call(f.admin.token, 'POST', `/pos-drafts/${first.id}/approve`, {
        revision: first.revision,
      });
      const postedFirst = await finishCashier(first, approved);
      const capture = envelope(product.id, 2);
      const continued = await call(stockist.accessToken, 'POST', '/pos-drafts', capture);
      assert.equal(continued.continuedExisting, true);
      assert.equal(continued.id, first.id);
      const aliasId = continued.captureDraftId;
      let alias = await db.posDraft.findUniqueOrThrow({ where: { id: aliasId } });
      assert.equal(alias.payload._continuesDraftId, first.id);
      assert.equal(
        Number(alias.pendingMoney),
        0,
        'A default continuation cannot duplicate the cashier money claim',
      );
      const beforeRepeat = await snapshot(product.id);
      await call(
        f.admin.token,
        'POST',
        `/pos-drafts/${aliasId}/approve`,
        { revision: alias.revision },
        400,
      );
      assert.deepEqual(await snapshot(product.id), beforeRepeat);
      assert.equal(
        (await call(f.admin.token, 'GET', '/pos-drafts/' + aliasId)).allowedActions.includes(
          'approve',
        ),
        true,
      );
      const review = await reviewerBody(aliasId);
      assert.ok(review.reviewedCandidateIds.includes(first.id));
      const results = await Promise.allSettled(
        [f.admin.token, f.reviewer.token].map((token) =>
          call(token, 'POST', `/pos-drafts/${aliasId}/approve`, review),
        ),
      );
      const accepted = results.filter((v) => v.status === 'fulfilled').map((v) => v.value);
      assert.equal(
        accepted.length,
        1,
        'Conflicting reviews cannot turn one capture into two repeat purchases',
      );
      const repeat = accepted[0];
      assert.equal(repeat.status, 'POSTED');
      assert.notEqual(repeat.postedEntityId, postedFirst.postedEntityId);
      alias = await db.posDraft.findUniqueOrThrow({
        where: { id: aliasId },
        include: { decisions: true },
      });
      assert.equal(alias.payload._continuesDraftId, undefined);
      assert.equal(alias.payload._separateRepeatOfDraftId, first.id);
      assert.equal(alias.requestId, capture.requestId);
      assert.equal(Number(alias.pendingMoney), 0);
      assert.equal(alias.decisions.filter((v) => v.action === 'REPEAT_REVIEW').length, 1);
      const order = await db.salesOrder.findUniqueOrThrow({ where: { id: repeat.postedEntityId } });
      assert.equal(order.createdById, stockist.operator.id);
      assert.equal(Number((await balance(product.id)).quantityOnHand), 6);
      assert.equal(Number((await balance(product.id)).quantityReserved), 0);
      assert.equal(await cash(), beforeMoney + 400);
      const after = await snapshot(product.id);
      const lostResponse = await call(stockist.accessToken, 'POST', '/pos-drafts', capture);
      assert.equal(lostResponse.id, aliasId);
      assert.equal(lostResponse.postedEntityId, repeat.postedEntityId);
      const outcome = await call(
        stockist.accessToken,
        'GET',
        '/pos-drafts/outcome/' + capture.requestId,
      );
      assert.equal(outcome.postedEntityId, repeat.postedEntityId);
      await call(f.admin.token, 'POST', `/pos-drafts/${aliasId}/approve`, {
        revision: repeat.revision,
      });
      assert.deepEqual(await snapshot(product.id), after);
    },
  );

  await check(
    'Reviewed stockist repeats cannot consume the outstanding cashier hold and retain their own rejected funds',
    async () => {
      const product = await productFixture('reserved cashier', 5);
      const first = await call(cashier.accessToken, 'POST', '/pos-drafts', envelope(product.id, 4));
      const approved = await call(f.admin.token, 'POST', `/pos-drafts/${first.id}/approve`, {
        revision: first.revision,
      });
      const continued = await call(
        stockist.accessToken,
        'POST',
        '/pos-drafts',
        envelope(product.id, 4),
      );
      assert.equal(continued.continuedExisting, true);
      const aliasId = continued.captureDraftId;
      const hold = await db.posDraftReservation.findFirstOrThrow({
        where: { draftId: first.id, releasedAt: null },
      });
      assert.equal(
        Number((await db.posDraft.findUniqueOrThrow({ where: { id: first.id } })).pendingMoney) +
          Number((await db.posDraft.findUniqueOrThrow({ where: { id: aliasId } })).pendingMoney),
        400,
        'A default matching capture carries the cashier funds claim only once',
      );
      const before = await snapshot(product.id);
      const review = await reviewerBody(aliasId);
      await call(f.admin.token, 'POST', `/pos-drafts/${aliasId}/approve`, review, 400);
      assert.deepEqual(
        await snapshot(product.id),
        before,
        'Insufficient available stock must leave every canonical effect rolled back',
      );
      const unchangedHold = await db.posDraftReservation.findUniqueOrThrow({
        where: { id: hold.id },
      });
      assert.equal(unchangedHold.releasedAt, null);
      assert.equal(Number(unchangedHold.quantity), 4);
      assert.equal(
        (await db.posDraft.findUniqueOrThrow({ where: { id: first.id } })).status,
        'AWAITING_STOCKIST',
      );
      const blocked = await db.posDraft.findUniqueOrThrow({
        where: { id: aliasId },
        include: { decisions: true },
      });
      assert.equal(blocked.status, 'NEEDS_ATTENTION');
      assert.equal(blocked.payload._continuesDraftId, undefined);
      assert.equal(blocked.payload._separateRepeatOfDraftId, first.id);
      assert.equal(
        Number(blocked.pendingMoney),
        400,
        'The separately collected funds remain visible after a failed repeat posting',
      );
      assert.equal(
        Number((await db.posDraft.findUniqueOrThrow({ where: { id: first.id } })).pendingMoney) +
          Number(blocked.pendingMoney),
        800,
        'Explicit genuine-repeat review accounts for both separately collected amounts',
      );
      assert.equal(blocked.postedEntityId, null);
      assert.equal(blocked.decisions.filter((v) => v.action === 'REPEAT_REVIEW').length, 1);
      const finished = await finishCashier(first, approved);
      assert.equal(finished.status, 'POSTED');
      assert.equal(Number((await balance(product.id)).quantityOnHand), 1);
      assert.equal(Number((await balance(product.id)).quantityReserved), 0);
      assert.equal(await cash(), before.cash + 400);
      const rejected = await call(f.reviewer.token, 'POST', `/pos-drafts/${aliasId}/reject`, {
        revision: blocked.revision,
        reason: 'Synthetic second purchase cannot be fulfilled; return its separate cash',
      });
      assert.equal(rejected.pendingMoney, 400);
      const beforeReturn = await snapshot(product.id);
      const returned = await call(f.admin.token, 'POST', `/pos-drafts/${aliasId}/confirm-return`, {
        revision: rejected.revision,
        fundsReturned: true,
        reason: 'Separate second-purchase cash returned to customer',
        reference: 'PROOF-REPEAT-RETURN-' + name,
      });
      assert.equal(returned.pendingMoney, 0);
      assert.equal(returned.amount, 400);
      assert.deepEqual(await snapshot(product.id), beforeReturn);
    },
  );

  await check(
    'Matching cashier sales across branches remain captured with their funds until scoped company-wide repeat review',
    async () => {
      const product = await productFixture('cross branch', 10);
      const first = await call(cashier.accessToken, 'POST', '/pos-drafts', envelope(product.id, 2));
      const approved = await call(f.admin.token, 'POST', `/pos-drafts/${first.id}/approve`, {
        revision: first.revision,
      });
      const posted = await finishCashier(first, approved);
      const destinationScope = { ...scope, branchId: f.destination.id };
      const destinationLedger = await db.chartOfAccount.create({
        data: {
          companyId: f.company.id,
          accountCode: '1011-' + name,
          accountName: 'Synthetic destination cash ledger ' + name,
          accountType: 'ASSET',
          accountSubType: 'cash_on_hand',
        },
      });
      const destinationCash = await db.cashAccount.create({
        data: {
          ...destinationScope,
          accountName: 'Synthetic cross-branch repeat till ' + name,
          accountType: 'CASH_ON_HAND',
          ledgerAccountId: destinationLedger.id,
          currency: 'TZS',
        },
      });
      const destinationBalance = await db.inventoryBalance.upsert({
        where: {
          companyId_productId_branchId: {
            companyId: f.company.id,
            productId: product.id,
            branchId: f.destination.id,
          },
        },
        create: {
          ...destinationScope,
          productId: product.id,
          quantityOnHand: 0,
          quantityReserved: 0,
          averageCost: 0,
          totalValue: 0,
        },
        update: {},
      });
      const initialized = await db.inventoryBalance.updateMany({
        where: {
          id: destinationBalance.id,
          companyId: f.company.id,
          productId: product.id,
          branchId: f.destination.id,
          quantityOnHand: 0,
          quantityReserved: 0,
          totalValue: 0,
          physicalRevision: 0,
        },
        data: { quantityOnHand: 10, averageCost: 40, totalValue: 400 },
      });
      assert.equal(
        initialized.count,
        1,
        "Only this new product's untouched zero destination balance may be initialized",
      );
      const destinationSetup = await call(
        f.admin.token,
        'POST',
        '/mobile-pos-onboarding/branch-setups',
        {
          ...destinationScope,
          generalCustomerId: f.customer.id,
          paymentMappings: [{ paymentMethod: 'CASH', cashAccountId: destinationCash.id }],
          approvalRequired: true,
        },
      );
      const destinationInvite = await call(
        f.admin.token,
        'POST',
        '/mobile-pos-onboarding/invites',
        { branchSetupId: destinationSetup.id },
      );
      const otherStockist = await actor('STOCKIST', destinationInvite.token);
      const before = await snapshot(product.id);
      const repeat = await call(otherStockist.accessToken, 'POST', '/pos-drafts', {
        ...envelope(product.id, 2),
        ...destinationScope,
      });
      assert.equal(repeat.continuedExisting, undefined);
      assert.equal(repeat.status, 'NEEDS_ATTENTION');
      assert.equal(repeat.branchId, f.destination.id);
      assert.equal(repeat.pendingMoney, 200);
      await call(
        f.admin.token,
        'POST',
        `/pos-drafts/${repeat.id}/approve`,
        { revision: repeat.revision },
        409,
      );
      assert.deepEqual(await snapshot(product.id), before);
      assert.equal(
        Number(
          (await db.inventoryBalance.findUniqueOrThrow({ where: { id: destinationBalance.id } }))
            .quantityOnHand,
        ),
        10,
      );
      assert.equal(
        Number(
          (await db.cashAccount.findUniqueOrThrow({ where: { id: destinationCash.id } }))
            .currentBalance,
        ),
        0,
      );
      const review = await reviewerBody(repeat.id);
      assert.ok(review.reviewedCandidateIds.includes(first.id));
      const accepted = await call(
        f.reviewer.token,
        'POST',
        `/pos-drafts/${repeat.id}/approve`,
        review,
      );
      assert.equal(accepted.status, 'POSTED');
      assert.notEqual(accepted.postedEntityId, posted.postedEntityId);
      const order = await db.salesOrder.findUniqueOrThrow({
        where: { id: accepted.postedEntityId },
      });
      assert.equal(order.createdById, otherStockist.operator.id);
      assert.equal(order.branchId, f.destination.id);
      assert.equal(Number((await balance(product.id)).quantityOnHand), 8);
      assert.equal(
        await cash(),
        before.cash,
        'The second branch purchase cannot credit the first branch till',
      );
      assert.equal(
        Number(
          (await db.inventoryBalance.findUniqueOrThrow({ where: { id: destinationBalance.id } }))
            .quantityOnHand,
        ),
        8,
      );
      assert.equal(
        Number(
          (await db.cashAccount.findUniqueOrThrow({ where: { id: destinationCash.id } }))
            .currentBalance,
        ),
        200,
      );
    },
  );
};
