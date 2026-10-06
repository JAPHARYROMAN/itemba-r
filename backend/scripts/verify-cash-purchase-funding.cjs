/* Financial effects are proved only in the guarded, owned synthetic POS database. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AccountingControlService } = require('../dist/common/services/accounting-control.service');
const { AccountResolverService } = require('../dist/common/services/account-resolver.service');
const {
  PostingEngineService,
} = require('../dist/modules/accounting-engine/posting-engine.service');

exports.verifyCashPurchaseFunding = async ({ db, check, fixture: f, call }) => {
  assert.ok(
    f.company.code.startsWith('POS-'),
    'Cash funding proof requires an owned synthetic company',
  );
  const scope = { companyId: f.company.id, divisionId: f.division.id, branchId: f.branch.id };
  const suffix = randomUUID(),
    date = new Date().toISOString().slice(0, 10);
  const ledger = await db.chartOfAccount.create({
    data: {
      companyId: f.company.id,
      accountCode: `FUND-${suffix}`,
      accountName: 'Synthetic main cash',
      accountType: 'ASSET',
    },
  });
  const cash = await db.cashAccount.create({
    data: {
      ...scope,
      accountName: `Synthetic funding ${suffix}`,
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
      ledgerAccountId: ledger.id,
      openingBalance: 20000,
      currentBalance: 20000,
    },
  });
  const desk = await db.cashDeskAccount.create({
    data: {
      ...scope,
      name: `Synthetic main desk ${suffix}`,
      nameKey: suffix,
      kind: 'CASH',
      currency: 'TZS',
      erpCashAccountId: cash.id,
      openingDate: new Date('2026-01-01'),
      balance: 20000,
    },
  });
  await db.cashDeskMovement.create({
    data: {
      requestId: randomUUID(),
      payloadKey: suffix,
      kind: 'OPENING',
      amount: 20000,
      currency: 'TZS',
      businessDate: new Date('2026-01-01'),
      description: 'Synthetic funding opening',
      reference: '',
      createdBy: f.admin.user.id,
      actorName: 'Proof officer',
      entries: {
        create: {
          accountId: desk.id,
          businessDate: new Date('2026-01-01'),
          amount: 20000,
          erpBalanceApplied: true,
        },
      },
    },
  });
  const balances = async () => [
    (await db.cashAccount.findUniqueOrThrow({ where: { id: cash.id } })).currentBalance.toFixed(2),
    (await db.cashDeskAccount.findUniqueOrThrow({ where: { id: desk.id } })).balance.toFixed(2),
  ];
  const inventory = async () =>
    JSON.stringify(
      await db.inventoryBalance.findMany({
        where: { companyId: f.company.id },
        orderBy: { id: 'asc' },
      }),
    );
  const poBody = {
    ...scope,
    purchaseType: 'CASH_PURCHASE',
    supplierId: f.supplier.id,
    currency: 'TZS',
    orderDate: new Date().toISOString(),
    lines: [
      {
        productId: f.product.id,
        unitId: f.unit.id,
        quantity: 2,
        unitCost: 1000,
        discountAmount: 0,
        taxAmount: 0,
      },
    ],
  };
  const createPo = async () => {
    const order = await call(f.admin.token, 'POST', '/purchase-orders', poBody);
    await call(f.admin.token, 'PATCH', `/purchase-orders/${order.id}/confirm`, {});
    return order;
  };
  let order, payment, payableId;
  await check(
    'Cash PO starts unpaid and exposes its connected funding account before any money or stock moves',
    async () => {
      const before = await balances(),
        beforeStock = await inventory();
      order = await createPo();
      assert.equal(order.paymentStatus, 'UNPAID');
      assert.equal(Number(order.paidAmount), 0);
      assert.equal(Number(order.outstandingAmount), 2000);
      const funding = await call(f.admin.token, 'GET', `/purchase-orders/${order.id}/cash-funding`);
      assert.equal(funding.amount, '2000.00');
      assert.ok(funding.accounts.some((a) => a.id === cash.id && a.name === desk.name));
      assert.deepEqual(await balances(), before);
      assert.equal(await inventory(), beforeStock);
    },
  );
  await check(
    'Cash receipt rejects an unrelated account and insufficient funds with all stock and financial effects rolled back',
    async () => {
      assert.ok(order);
      const beforeStock = await inventory();
      await call(
        f.admin.token,
        'PATCH',
        `/purchase-orders/${order.id}/receive`,
        { cashAccountId: randomUUID() },
        400,
      );
      await db.cashAccount.update({ where: { id: cash.id }, data: { currentBalance: 100 } });
      await call(
        f.admin.token,
        'PATCH',
        `/purchase-orders/${order.id}/receive`,
        { cashAccountId: cash.id },
        400,
      );
      assert.equal(
        (await db.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status,
        'CONFIRMED',
      );
      assert.equal(
        await db.payable.count({ where: { sourceType: 'PurchaseOrder', sourceId: order.id } }),
        0,
      );
      assert.equal(
        await db.supplierPayment.count({
          where: { sourceType: 'PurchaseOrder', sourceId: order.id },
        }),
        0,
      );
      assert.equal(await inventory(), beforeStock);
      assert.deepEqual(await balances(), ['100.00', '20000.00']);
      await db.cashAccount.update({ where: { id: cash.id }, data: { currentBalance: 20000 } });
    },
  );
  await check(
    'Concurrent cash receipt deducts both books once, posts stock once, and records one allocated supplier payment with the strict flag off',
    async () => {
      assert.ok(order);
      const attempts = await Promise.allSettled(
        [0, 1].map(() =>
          call(f.admin.token, 'PATCH', `/purchase-orders/${order.id}/receive`, {
            cashAccountId: cash.id,
          }),
        ),
      );
      assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(attempts.filter((r) => r.status === 'rejected').length, 1);
      const received = await db.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
      payableId = received.payableId;
      assert.equal(received.paymentStatus, 'PAID');
      assert.equal(Number(received.paidAmount), 2000);
      assert.equal(Number(received.outstandingAmount), 0);
      assert.equal(
        await db.inventoryMovement.count({
          where: { referenceType: 'PurchaseOrder', referenceId: order.id },
        }),
        1,
      );
      const payments = await db.supplierPayment.findMany({
        where: { sourceType: 'PurchaseOrder', sourceId: order.id },
        include: { allocations: true },
      });
      assert.equal(payments.length, 1);
      payment = payments[0];
      assert.equal(payment.cashAccountId, cash.id);
      assert.equal(Number(payment.amount), 2000);
      assert.equal(payment.allocations[0].payableId, payableId);
      assert.ok(payment.cashDeskMovementId);
      assert.deepEqual(await balances(), ['18000.00', '18000.00']);
      const entry = await db.cashDeskEntry.findFirstOrThrow({
        where: { movementId: payment.cashDeskMovementId, accountId: desk.id },
      });
      assert.equal(entry.erpBalanceApplied, true);
      const stableStock = await inventory();
      await call(
        f.admin.token,
        'PATCH',
        `/purchase-orders/${order.id}/receive`,
        { cashAccountId: cash.id },
        400,
      );
      assert.equal(await inventory(), stableStock);
      assert.deepEqual(await balances(), ['18000.00', '18000.00']);
    },
  );
  await check(
    'Reversing a cash PO payment restores cash and debt without undoing goods; Cash Desk settles the same debt without reposting stock',
    async () => {
      assert.ok(payment && payableId);
      const stock = await inventory();
      await call(f.admin.token, 'PATCH', `/supplier-payments/${payment.id}/reverse`, {
        reason: 'Synthetic payment reversal',
      });
      assert.deepEqual(await balances(), ['20000.00', '20000.00']);
      assert.equal(
        (await db.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus,
        'UNPAID',
      );
      const input = {
        requestId: randomUUID(),
        kind: 'SUPPLIER_PAYMENT',
        accountId: desk.id,
        payableId,
        supplierId: f.supplier.id,
        amount: '2000.00',
        businessDate: date,
        description: 'Synthetic debt settlement',
        reference: '',
      };
      const movement = await call(f.admin.token, 'POST', '/cash-desk/movements', input);
      await call(f.admin.token, 'POST', '/cash-desk/movements', input);
      assert.deepEqual(await balances(), ['18000.00', '18000.00']);
      assert.ok(movement.supplierPaymentId);
      assert.equal(await inventory(), stock);
      assert.equal(
        (await db.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus,
        'PAID',
      );
    },
  );
  await check(
    'Cash Desk expenses deduct the connected balance once and reversal restores both balances',
    async () => {
      const input = {
        requestId: randomUUID(),
        kind: 'EXPENSE',
        accountId: desk.id,
        amount: '700.00',
        businessDate: date,
        description: 'Synthetic cash expense',
        reference: '',
        expenseCategory: 'OTHER',
      };
      const movement = await call(f.admin.token, 'POST', '/cash-desk/movements', input);
      await call(f.admin.token, 'POST', '/cash-desk/movements', input);
      assert.deepEqual(await balances(), ['17300.00', '17300.00']);
      assert.equal(
        (await db.cashDeskEntry.findFirstOrThrow({ where: { movementId: movement.id } }))
          .erpBalanceApplied,
        true,
      );
      const review = await call(f.admin.token, 'GET', `/cash-connections/movements/${movement.id}`);
      assert.equal(review.issues.length, 0);
      const offset = review.offsetId ?? review.accounts[0]?.id;
      await call(f.admin.token, 'POST', `/cash-connections/movements/${movement.id}`, {
        fingerprint: review.fingerprint,
        offsetAccountId: offset,
      });
      assert.deepEqual(await balances(), ['17300.00', '17300.00']);
      await call(f.admin.token, 'POST', `/cash-desk/movements/${movement.id}/reverse`, {
        requestId: randomUUID(),
        reason: 'Synthetic expense reversal',
        businessDate: date,
      });
      assert.deepEqual(await balances(), ['18000.00', '18000.00']);
    },
  );
  await check(
    'Legacy cash PO is selectable as unrecorded cash, then reclassifies its old journal and pays without another inventory debit',
    async () => {
      const legacy = await createPo();
      const resolver = new AccountResolverService(db),
        control = new AccountingControlService(db);
      const engine = new PostingEngineService(db, control, resolver);
      const roles = await resolver.resolveMany(
        f.company.id,
        ['INVENTORY_ASSET', 'CASH_ON_HAND'],
        db,
      );
      const original = await db.$transaction((tx) =>
        engine.postLines(
          {
            ...scope,
            transactionDate: new Date(),
            description: 'Synthetic old cash PO receipt',
            referenceType: 'PurchaseOrder',
            referenceId: legacy.id,
            moduleName: 'purchase-orders',
            userId: f.admin.user.id,
            lines: [
              { accountId: roles.INVENTORY_ASSET.id, debit: 2000, credit: 0 },
              { accountId: roles.CASH_ON_HAND.id, debit: 0, credit: 2000 },
            ],
          },
          tx,
        ),
      );
      await db.purchaseOrder.update({
        where: { id: legacy.id },
        data: {
          status: 'RECEIVED',
          receivedAt: new Date(),
          journalEntryId: original.id,
          paidAmount: 2000,
          outstandingAmount: 0,
          paymentStatus: 'PAID',
        },
      });
      const options = await call(
        f.admin.token,
        'GET',
        `/cash-desk/purchase-options?accountId=${desk.id}&supplierId=${f.supplier.id}&search=${legacy.internalInvoiceNumber}`,
      );
      const row = options.rows.find((r) => r.id === legacy.id);
      assert.equal(row.purpose, 'CASH_PURCHASE_SETTLEMENT');
      assert.equal(row.outstanding, '2000.00');
      const stock = await inventory();
      const journalLinesBefore = await db.journalEntryLine.count({
        where: { accountId: roles.INVENTORY_ASSET.id },
      });
      const input = {
        requestId: randomUUID(),
        kind: 'SUPPLIER_PAYMENT',
        accountId: desk.id,
        purchaseOrderId: legacy.id,
        supplierId: f.supplier.id,
        amount: '2000.00',
        businessDate: date,
        description: 'Synthetic old cash payment',
        reference: '',
      };
      await call(f.admin.token, 'POST', '/cash-desk/movements', input);
      await call(f.admin.token, 'POST', '/cash-desk/movements', input);
      assert.deepEqual(await balances(), ['16000.00', '16000.00']);
      assert.equal(await inventory(), stock);
      assert.equal(
        await db.journalEntryLine.count({ where: { accountId: roles.INVENTORY_ASSET.id } }),
        journalLinesBefore,
      );
      assert.equal(
        (await db.journalEntry.findUniqueOrThrow({ where: { id: original.id } })).status,
        'POSTED',
      );
      const repaired = await db.purchaseOrder.findUniqueOrThrow({ where: { id: legacy.id } });
      assert.ok(repaired.payableId);
      assert.equal(repaired.paymentStatus, 'PAID');
      assert.equal(
        await db.auditLog.count({
          where: { action: 'CASH_PURCHASE_PAYMENT_REPAIR', entityId: legacy.id },
        }),
        1,
      );
    },
  );
  await check(
    'Recorded-only expense correction requires exact reviewed evidence, changes ERP once, and preserves desk movements and journals',
    async () => {
      const input = {
        requestId: randomUUID(),
        kind: 'EXPENSE',
        accountId: desk.id,
        amount: '300.00',
        businessDate: date,
        description: 'Synthetic pre-fix expense',
        reference: '',
        expenseCategory: 'OTHER',
      };
      const movement = await call(f.admin.token, 'POST', '/cash-desk/movements', input);
      // Reproduce the old bug only in this disposable fixture: the desk deduction happened, ERP did not.
      await db.cashAccount.update({
        where: { id: cash.id },
        data: { currentBalance: { increment: 300 } },
      });
      await db.cashDeskEntry.updateMany({
        where: { movementId: movement.id },
        data: { erpBalanceApplied: false },
      });
      const path = `/cash-connections/accounts/${desk.id}/balance-repair`;
      const review = await call(f.admin.token, 'GET', path);
      assert.equal(review.canApply, true);
      assert.equal(review.rows.length, 1);
      assert.equal(review.rows[0].movementId, movement.id);
      const counts = async () => [await db.cashDeskMovement.count(), await db.journalEntry.count()];
      const before = await counts();
      await call(f.admin.token, 'POST', path, { fingerprint: '0'.repeat(64) }, 409);
      assert.deepEqual(await balances(), ['16000.00', '15700.00']);
      await call(f.admin.token, 'POST', path, { fingerprint: review.fingerprint });
      await call(f.admin.token, 'POST', path, { fingerprint: review.fingerprint }, 409);
      assert.deepEqual(await balances(), ['15700.00', '15700.00']);
      assert.deepEqual(await counts(), before);
      assert.equal(
        (await db.cashDeskEntry.findFirstOrThrow({ where: { movementId: movement.id } }))
          .erpBalanceApplied,
        true,
      );
      assert.equal(
        await db.auditLog.count({
          where: { action: 'CASH_DESK_BALANCE_REPAIR', entityId: desk.id },
        }),
        1,
      );
    },
  );
  await check(
    'Cash PO supplier advance is applied at receipt and only the remaining cash is deducted',
    async () => {
      const prepaid = await createPo();
      await call(f.admin.token, 'POST', '/cash-desk/movements', {
        requestId: randomUUID(),
        kind: 'SUPPLIER_PAYMENT',
        accountId: desk.id,
        purchaseOrderId: prepaid.id,
        supplierId: f.supplier.id,
        amount: '300.00',
        businessDate: date,
        description: 'Synthetic cash purchase advance',
        reference: '',
      });
      assert.deepEqual(await balances(), ['15400.00', '15400.00']);
      const funding = await call(
        f.admin.token,
        'GET',
        `/purchase-orders/${prepaid.id}/cash-funding`,
      );
      assert.equal(funding.amount, '1700.00');
      await call(f.admin.token, 'PATCH', `/purchase-orders/${prepaid.id}/receive`, {
        cashAccountId: cash.id,
      });
      assert.deepEqual(await balances(), ['13700.00', '13700.00']);
      const completed = await db.purchaseOrder.findUniqueOrThrow({ where: { id: prepaid.id } });
      assert.equal(completed.paymentStatus, 'PAID');
      assert.equal(Number(completed.paidAmount), 2000);
      assert.equal(
        await db.supplierPurchaseAdvanceApplication.count({
          where: { payableId: completed.payableId },
        }),
        1,
      );
      const remaining = await db.supplierPayment.findFirstOrThrow({
        where: { sourceType: 'PurchaseOrder', sourceId: prepaid.id, status: 'COMPLETED' },
      });
      assert.equal(Number(remaining.amount), 1700);
    },
  );
};
