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
      db.cashDeskMovement.count({
        where: { entries: { some: { account: { companyId: f.company.id } } } },
      }),
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
  await check(
    'The first two purchases in a new company allocate both number sequences safely',
    async () => {
      const company = await db.company.create({
        data: {
          groupId: f.company.groupId,
          code: `${f.company.code}-FIRST`,
          name: 'Synthetic first purchase company',
        },
      });
      await db.companyProfile.create({
        data: {
          companyId: company.id,
          registeredName: company.name,
          brelaRegNumber: company.id,
          tin: company.id,
          registeredAddress: 'Private rehearsal fixture',
          currency: 'TZS',
        },
      });
      const category = await db.productCategory.create({
        data: { companyId: company.id, name: 'First purchase category' },
      });
      const unit = await db.unitOfMeasure.create({
        data: { companyId: company.id, name: 'Piece', symbol: 'pc' },
      });
      const product = await db.product.create({
        data: {
          companyId: company.id,
          productCode: 'FIRST',
          name: 'First purchase product',
          categoryId: category.id,
          baseUnitId: unit.id,
          defaultPurchasePrice: 1000,
        },
      });
      const role = await db.role.create({
        data: {
          name: `PO-FIRST-${company.id}`,
          displayName: 'Synthetic first purchase officer',
          scope: 'COMPANY',
          rolePermissions: { create: [{ permission: { connect: { code: 'purchases.create' } } }] },
        },
      });
      const user = await db.user.create({
        data: {
          companyId: company.id,
          fullName: 'Synthetic first purchase officer',
          email: `first-purchase-${company.id}@example.invalid`,
          passwordHash: f.admin.user.passwordHash,
          status: 'ACTIVE',
          userRoles: { create: { roleId: role.id } },
          companyAccess: { create: { companyId: company.id, accessLevel: 'MANAGE' } },
        },
      });
      const session = await call(null, 'POST', '/auth/login', {
        email: user.email,
        password: process.env.RELEASE_PROOF_USER_PASSWORD,
      });
      const direct = {
        companyId: company.id,
        supplierName: 'Synthetic first supplier',
        purchaseType: 'STOCK_PURCHASE',
        orderDate: new Date().toISOString(),
        currency: 'TZS',
        lines: [{ productId: product.id, unitId: unit.id, quantity: 1, unitCost: 1000 }],
      };
      const results = await Promise.all(
        [0, 1].map(() => call(session.accessToken, 'POST', '/purchase-orders', direct)),
      );
      assert.notEqual(results[0].purchaseOrderNumber, results[1].purchaseOrderNumber);
      assert.notEqual(results[0].internalInvoiceNumber, results[1].internalInvoiceNumber);
      assert.equal(await db.purchaseOrder.count({ where: { companyId: company.id } }), 2);
    },
  );
  await check(
    'Cash Desk finds pending and payable purchases by internal, supplier invoice and PO numbers without posting money',
    async () => {
      assert.ok(converted, 'Conversion proof dependency must succeed');
      const desk = await db.cashDeskAccount.findFirstOrThrow({
        where: { companyId: f.company.id, erpCashAccountId: f.cash.id },
      });
      const options = (search) =>
        call(
          f.admin.token,
          'GET',
          `/cash-desk/purchase-options?accountId=${desk.id}&supplierId=${f.supplier.id}&search=${encodeURIComponent(search)}`,
        );
      const before = await counters();
      const pending = await options(` ${converted.internalInvoiceNumber.toLowerCase()} `);
      assert.ok(
        pending.orderMatches.some((row) => row.id === converted.id && row.status === 'DRAFT'),
      );
      assert.ok(!pending.rows.some((row) => row.purchaseOrderId === converted.id));
      const invoice = await db.supplierInvoice.findFirstOrThrow({
        where: {
          companyId: f.company.id,
          supplierId: f.supplier.id,
          status: 'APPROVED',
          deletedAt: null,
          purchaseOrderId: { not: null },
          payable: {
            status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
            outstandingAmount: { gt: 0 },
            deletedAt: null,
          },
        },
        include: { purchaseOrder: true },
      });
      const order = await db.purchaseOrder.update({
        where: { id: invoice.purchaseOrderId },
        data: {
          internalInvoiceNumber: `PINV-SEARCH-${f.company.id}`,
          supplierInvoiceNumber: `SUP-SEARCH-${f.company.id}`,
        },
      });
      for (const search of [
        order.internalInvoiceNumber,
        order.supplierInvoiceNumber,
        order.purchaseOrderNumber,
        invoice.supplierInvoiceNumber,
      ]) {
        const result = await options(search);
        const row = result.rows.find((candidate) => candidate.id === invoice.payableId);
        assert.ok(row, `Existing payable must resolve by ${search}`);
        assert.equal(row.purchaseOrderId, order.id);
        assert.equal(row.internalInvoiceNumber, order.internalInvoiceNumber);
        assert.equal(row.canPay, true);
        assert.ok(!result.orderMatches.some((match) => match.id === order.id));
      }
      assert.deepEqual(await counters(), before);
    },
  );
};
