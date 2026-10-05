/* Called only by the isolated POS rehearsal runner, after its existing proofs. */
const assert = require('node:assert/strict');

exports.verifyPurchaseDraftConversion = async ({ db, check, fixture: f, call }) => {
  assert.ok(
    f.company.code.startsWith('POS-'),
    'Conversion proof requires an owned synthetic fixture',
  );
  const scope = { companyId: f.company.id, divisionId: f.division.id, branchId: f.branch.id };
  const counters = async () =>
    Promise.all([
      db.inventoryMovement.count({ where: { companyId: f.company.id } }),
      db.payable.count({ where: { companyId: f.company.id } }),
      db.journalEntry.count({ where: { companyId: f.company.id } }),
      db.cashDeskMovement.count({ where: { companyId: f.company.id } }),
    ]);
  let draft, converted;
  const body = () => ({
    ...scope,
    supplierId: f.supplier.id,
    purchaseType: 'STOCK_PURCHASE',
    orderDate: new Date().toISOString(),
    currency: 'TZS',
    lines: [
      {
        sourceDraftLineId: draft.lines[0].id,
        productId: f.product.id,
        unitId: f.unit.id,
        quantity: 2,
        unitCost: 1000,
        discountAmount: 10,
        taxAmount: 0,
      },
    ],
  });
  await check(
    'Supplier draft converts once under concurrent requests and creates no inventory or accounting entries',
    async () => {
      draft = await call(f.admin.token, 'POST', '/supplier-order-drafts', {
        ...scope,
        supplierId: f.supplier.id,
        draftDate: new Date().toISOString(),
        currency: 'TZS',
        deliveryInstructions: 'Synthetic conversion delivery',
        terms: 'Net 30',
        lines: [
          {
            description: 'Synthetic conversion item',
            quantity: 2,
            unitLabel: f.unit.name,
            unitPrice: 1000,
            discountAmount: 10,
            taxAmount: 0,
          },
        ],
      });
      await call(null, 'POST', `/purchase-orders/from-draft/${draft.id}`, body(), 401);
      await call(
        f.admin.token,
        'POST',
        `/purchase-orders/from-draft/${draft.id}`,
        { ...body(), companyId: 'another-company' },
        400,
      );
      const before = await counters();
      const responses = await Promise.all(
        [0, 1].map(() =>
          call(f.admin.token, 'POST', `/purchase-orders/from-draft/${draft.id}`, body()),
        ),
      );
      assert.equal(responses[0].id, responses[1].id);
      converted = responses[0];
      assert.equal(await db.purchaseOrder.count({ where: { sourceDraftId: draft.id } }), 1);
      assert.ok(converted.internalInvoiceNumber.startsWith('PINV-'));
      assert.equal(converted.supplierInvoiceNumber, null);
      assert.equal(converted.supplierId, f.supplier.id);
      assert.equal(converted.status, 'DRAFT');
      assert.equal(Number(converted.totalAmount), 1990);
      assert.deepEqual(await counters(), before);
    },
  );
  await check(
    'Converted draft exposes its linked purchase order and rejects subsequent changes',
    async () => {
      assert.ok(draft && converted, 'Conversion proof dependency must succeed');
      const source = await call(f.admin.token, 'GET', `/supplier-order-drafts/${draft.id}`);
      assert.equal(source.convertedPurchaseOrder.id, converted.id);
      await call(f.admin.token, 'PATCH', `/supplier-order-drafts/${draft.id}/send`, {}, 400);
      const details = await call(f.admin.token, 'GET', `/purchase-orders/${converted.id}`);
      assert.equal(details.sourceDraft.draftNumber, draft.draftNumber);
      assert.equal(details.internalInvoiceNumber, converted.internalInvoiceNumber);
    },
  );
  await check(
    'Direct purchases preserve supplier invoices and generate distinct internal numbers without financial posting',
    async () => {
      assert.ok(draft && converted, 'Conversion proof dependency must succeed');
      const before = await counters();
      const direct = body();
      delete direct.lines[0].sourceDraftLineId;
      const results = await Promise.all(
        [0, 1].map((index) =>
          call(f.admin.token, 'POST', '/purchase-orders', {
            ...direct,
            ...(index === 0 ? { supplierInvoiceNumber: `SYNTHETIC-SUP-${draft.id}` } : {}),
          }),
        ),
      );
      assert.notEqual(results[0].internalInvoiceNumber, results[1].internalInvoiceNumber);
      assert.notEqual(results[0].internalInvoiceNumber, converted.internalInvoiceNumber);
      assert.equal(results[0].supplierInvoiceNumber, `SYNTHETIC-SUP-${draft.id}`);
      assert.equal(results[1].supplierInvoiceNumber, null);
      assert.deepEqual(await counters(), before);
      const found = await call(
        f.admin.token,
        'GET',
        `/purchase-orders?companyId=${f.company.id}&invoiceNumber=${encodeURIComponent(results[1].internalInvoiceNumber)}`,
      );
      assert.ok(found.data.some((row) => row.id === results[1].id));
    },
  );
};
