/* Runs only within the guarded disposable POS rehearsal database. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

exports.verifySupplierPurchaseAdvances = async ({ db, check, fixture: f, call }) => {
  assert.ok(f.company.code.startsWith('POS-'), 'Advance proof requires an owned synthetic company');
  const scope = { companyId: f.company.id, divisionId: f.division.id, branchId: f.branch.id };
  const date = new Date().toISOString().slice(0, 10);
  const suffix = randomUUID();
  const ledger = await db.chartOfAccount.create({
    data: {
      companyId: f.company.id,
      accountCode: `ADV-${suffix}`,
      accountName: `Proof advance cash ${suffix}`,
      accountType: 'ASSET',
    },
  });
  const cash = await db.cashAccount.create({
    data: {
      ...scope,
      accountName: `Proof advance till ${suffix}`,
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
      ledgerAccountId: ledger.id,
      openingBalance: 10000,
      currentBalance: 10000,
    },
  });
  const desk = await db.cashDeskAccount.create({
    data: {
      ...scope,
      name: `Proof advance drawer ${suffix}`,
      nameKey: suffix,
      kind: 'CASH',
      currency: 'TZS',
      erpCashAccountId: cash.id,
      openingDate: new Date('2026-01-01'),
      balance: 10000,
    },
  });
  await db.cashDeskMovement.create({
    data: {
      requestId: randomUUID(),
      payloadKey: suffix,
      kind: 'OPENING',
      amount: 10000,
      currency: 'TZS',
      businessDate: new Date('2026-01-01'),
      description: 'Synthetic advance drawer opening',
      reference: suffix,
      createdBy: f.admin.user.id,
      actorName: 'Proof purchase officer',
      entries: {
        create: { accountId: desk.id, businessDate: new Date('2026-01-01'), amount: 10000 },
      },
    },
  });
  const balances = async () => [
    (await db.cashAccount.findUniqueOrThrow({ where: { id: cash.id } })).currentBalance.toFixed(2),
    (await db.cashDeskAccount.findUniqueOrThrow({ where: { id: desk.id } })).balance.toFixed(2),
  ];
  const body = {
    ...scope,
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
  const payment = (order, amount) => ({
    requestId: randomUUID(),
    kind: 'SUPPLIER_PAYMENT',
    accountId: desk.id,
    supplierId: f.supplier.id,
    purchaseOrderId: order.id,
    amount,
    businessDate: date,
    description: 'Synthetic supplier advance',
    reference: order.internalInvoiceNumber,
  });
  const options = (order) =>
    call(
      f.admin.token,
      'GET',
      `/cash-desk/purchase-options?accountId=${desk.id}&supplierId=${f.supplier.id}&search=${order.internalInvoiceNumber}`,
    );
  let stock, stockMovement, credit, creditMovement;
  await check(
    'Confirmed PO advances debit cash exactly once under retries, enforce remaining balance, and reverse before receipt',
    async () => {
      stock = await call(f.admin.token, 'POST', '/purchase-orders', {
        ...body,
        purchaseType: 'STOCK_PURCHASE',
      });
      await call(f.admin.token, 'POST', '/cash-desk/movements', payment(stock, '300.00'), 409);
      await call(f.admin.token, 'PATCH', `/purchase-orders/${stock.id}/confirm`, {});
      const row = (await options(stock)).rows.find((r) => r.id === stock.id);
      assert.equal(row.source, 'PURCHASE_ORDER');
      assert.equal(row.canPay, true);
      const before = await balances();
      const input = payment(stock, '300.00');
      const responses = await Promise.all(
        [0, 1].map(() => call(f.admin.token, 'POST', '/cash-desk/movements', input)),
      );
      assert.equal(responses[0].id, responses[1].id);
      stockMovement = responses[0];
      const after = await balances();
      assert.deepEqual(
        after.map(Number),
        before.map((v) => Number(v) - 300),
      );
      const sp = await db.supplierPayment.findUniqueOrThrow({
        where: { requestId: input.requestId },
        include: {
          purchaseAdvance: true,
          journalEntry: { include: { lines: { include: { account: true } } } },
          allocations: true,
        },
      });
      assert.equal(sp.unappliedAmount.toFixed(2), '300.00');
      assert.equal(sp.appliedAmount.toFixed(2), '0.00');
      assert.equal(sp.purchaseAdvance.purchaseOrderId, stock.id);
      assert.equal(sp.allocations.length, 0);
      assert.equal(
        sp.journalEntry.lines.find((l) => l.debit.gt(0)).account.accountSubType,
        'supplier_advances',
      );
      assert.equal(
        (await options(stock)).rows.find((r) => r.id === stock.id).outstanding,
        '1700.00',
      );
      await call(
        f.admin.token,
        'POST',
        '/cash-desk/movements',
        { ...input, amount: '301.00' },
        409,
      );
      await call(f.admin.token, 'POST', '/cash-desk/movements', payment(stock, '1700.01'), 400);
      await call(f.admin.token, 'PATCH', `/purchase-orders/${stock.id}/cancel`, {}, 400);
      const reversal = {
        requestId: randomUUID(),
        reason: 'Synthetic advance correction',
        businessDate: date,
      };
      const reversals = await Promise.all(
        [0, 1].map(() =>
          call(f.admin.token, 'POST', `/cash-desk/movements/${stockMovement.id}/reverse`, reversal),
        ),
      );
      assert.equal(reversals[0].id, reversals[1].id);
      assert.deepEqual(await balances(), before);
      assert.equal(
        (
          await db.purchaseOrder.findUniqueOrThrow({ where: { id: stock.id } })
        ).outstandingAmount.toFixed(2),
        '2000.00',
      );
    },
  );
  await check(
    'Receiving a credit PO applies its advance to AP without taking cash twice; applied advance reversal restores AP and both cash accounts',
    async () => {
      credit = await call(f.admin.token, 'POST', '/purchase-orders', {
        ...body,
        purchaseType: 'CREDIT_PURCHASE',
      });
      await call(f.admin.token, 'PATCH', `/purchase-orders/${credit.id}/confirm`, {});
      const before = await balances();
      const input = payment(credit, '750.00');
      creditMovement = await call(f.admin.token, 'POST', '/cash-desk/movements', input);
      const paidBalances = await balances();
      await call(f.admin.token, 'PATCH', `/purchase-orders/${credit.id}/receive`, {});
      assert.deepEqual(await balances(), paidBalances);
      let order = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: credit.id },
        include: { payable: true },
      });
      assert.equal(order.paidAmount.toFixed(2), '750.00');
      assert.equal(order.outstandingAmount.toFixed(2), '1250.00');
      assert.equal(order.payable.paidAmount.toFixed(2), '750.00');
      assert.equal(order.payable.outstandingAmount.toFixed(2), '1250.00');
      const sp = await db.supplierPayment.findUniqueOrThrow({
        where: { requestId: input.requestId },
        include: { purchaseAdvance: { include: { applications: true } } },
      });
      assert.equal(sp.unappliedAmount.toFixed(2), '0.00');
      assert.equal(sp.appliedAmount.toFixed(2), '750.00');
      assert.equal(sp.purchaseAdvance.applications.length, 1);
      const found = await options(credit);
      assert.equal(found.rows.find((r) => r.purchaseOrderId === credit.id).source, 'PAYABLE');
      await call(f.admin.token, 'POST', `/cash-desk/movements/${creditMovement.id}/reverse`, {
        requestId: randomUUID(),
        businessDate: date,
        reason: 'Synthetic applied advance correction',
      });
      assert.deepEqual(await balances(), before);
      order = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: credit.id },
        include: { payable: true },
      });
      assert.equal(order.paidAmount.toFixed(2), '0.00');
      assert.equal(order.payable.outstandingAmount.toFixed(2), '2000.00');
      const application = await db.supplierPurchaseAdvanceApplication.findFirstOrThrow({
        where: { advance: { supplierPaymentId: sp.id } },
      });
      assert.ok(application.reversalJournalEntryId);
    },
  );
  await check(
    'Stock PO supplier invoice approval automatically applies a full advance and keeps its cash and application unchanged on retry',
    async () => {
      assert.ok(stock, 'Stock PO proof must succeed first');
      const input = payment(stock, '2000.00');
      await call(f.admin.token, 'POST', '/cash-desk/movements', input);
      const after = await balances();
      await call(f.admin.token, 'PATCH', `/purchase-orders/${stock.id}/receive`, {});
      const invoice = await call(f.admin.token, 'POST', '/supplier-invoices', {
        ...scope,
        supplierId: f.supplier.id,
        purchaseOrderId: stock.id,
        supplierInvoiceNumber: `ADV-${stock.id}`,
        invoiceDate: new Date().toISOString(),
        currency: 'TZS',
        lines: [
          {
            productId: f.product.id,
            description: 'Synthetic advance invoice',
            quantity: 2,
            unitPrice: 1000,
            discountAmount: 0,
            taxAmount: 0,
          },
        ],
      });
      const approved = await call(
        f.admin.token,
        'POST',
        `/supplier-invoices/${invoice.id}/approve`,
        { allowVariance: true },
      );
      assert.equal(approved.status, 'PAID');
      assert.equal(Number(approved.outstandingAmount), 0);
      assert.deepEqual(await balances(), after);
      await call(
        f.admin.token,
        'POST',
        `/supplier-invoices/${invoice.id}/approve`,
        { allowVariance: true },
        400,
      );
      assert.equal(
        await db.supplierPurchaseAdvanceApplication.count({
          where: { advance: { supplierPayment: { requestId: input.requestId } } },
        }),
        1,
      );
      assert.deepEqual(await balances(), after);
    },
  );
};
