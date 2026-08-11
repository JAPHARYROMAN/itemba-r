import { GoodsReceivedNotesService } from './goods-received-notes.service';

function makeService() {
  const approvedGrn = {
    id: 'grn-1',
    grnNumber: 'GRN-2026-000001',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    purchaseOrderId: null,
    supplierId: 'supplier-1',
    receivedDate: new Date('2026-06-17T00:00:00.000Z'),
    status: 'APPROVED',
    lines: [
      {
        id: 'grn-line-1',
        productId: 'product-1',
        unitId: 'unit-1',
        acceptedQuantity: 20,
        unitCost: null,
      },
    ],
  };

  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    // FOR UPDATE row-lock on the linked PO (over-receipt serialization). Default
    // to a single locked row so PO-linked posts proceed; tests that exercise the
    // missing-PO path override this.
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'po-1' }]),
    goodsReceivedNote: {
      findFirst: jest.fn().mockResolvedValue(approvedGrn),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    goodsReceivedNoteLine: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'product-1',
          name: 'Product 1',
          trackInventory: true,
          baseUnitId: 'unit-1',
          defaultPurchasePrice: 7,
        },
      ]),
    },
    purchaseOrderLine: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    purchaseOrder: {
      findFirst: jest.fn().mockResolvedValue({
        purchaseOrderNumber: 'PO-2026-000001',
        status: 'CONFIRMED',
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryMovement: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    // findOne/findAll attach a relation-shaped `supplier` object (GRN has no
    // Prisma relation to Supplier), which batch-fetches the referenced suppliers.
    supplier: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'supplier-1', name: 'Supplier One', supplierCode: 'SUP-001' }]),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  } as any;
  const inventoryMovements = { createMovement: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new GoodsReceivedNotesService(
    prisma,
    auditLogs,
    companyScope,
    inventoryMovements,
  );

  return { service, prisma, inventoryMovements, approvedGrn };
}

const user = { id: 'user-1' } as any;

describe('GoodsReceivedNotesService stock posting idempotency', () => {
  it('claims an approved GRN before creating inventory movements', async () => {
    const { service, prisma, inventoryMovements } = makeService();

    await service.post('grn-1', user);

    expect(prisma.goodsReceivedNote.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grn-1', deletedAt: null, status: 'APPROVED' },
        data: expect.objectContaining({ status: 'POSTED', postedById: 'user-1' }),
      }),
    );
    expect(inventoryMovements.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        movementType: 'PURCHASE_RECEIPT',
        quantity: 20,
        referenceType: 'GoodsReceivedNote',
        referenceId: 'grn-1',
        branchId: 'branch-1',
      }),
    );
  });

  it('values a no-PO receipt at the product default purchase price and persists it onto the line', async () => {
    const { service, prisma, inventoryMovements } = makeService();

    await service.post('grn-1', user);

    // No PO and no line-level cost, so the receipt falls back to the product's
    // default purchase price (7) instead of the previous `undefined`.
    expect(inventoryMovements.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ unitCost: 7 }),
    );
    expect(prisma.goodsReceivedNoteLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grn-line-1' },
        data: { unitCost: 7 },
      }),
    );
  });

  it('prefers the GRN line own unitCost over PO and product default, without re-persisting it', async () => {
    const { service, prisma, inventoryMovements, approvedGrn } = makeService();
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      ...approvedGrn,
      purchaseOrderId: 'po-1',
      lines: [
        {
          id: 'grn-line-1',
          productId: 'product-1',
          unitId: 'unit-1',
          acceptedQuantity: 20,
          unitCost: 12,
        },
      ],
    });
    prisma.purchaseOrderLine.findMany.mockResolvedValue([
      { productId: 'product-1', unitId: 'unit-1', quantity: 20, unitCost: 3 },
    ]);

    await service.post('grn-1', user);

    expect(inventoryMovements.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ unitCost: 12 }),
    );
    // The line already carries its own cost, so post() does not rewrite it.
    expect(prisma.goodsReceivedNoteLine.update).not.toHaveBeenCalled();
  });

  it('falls back to the matching PO line unitCost when the GRN line has none', async () => {
    const { service, prisma, inventoryMovements, approvedGrn } = makeService();
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      ...approvedGrn,
      purchaseOrderId: 'po-1',
    });
    prisma.purchaseOrderLine.findMany.mockResolvedValue([
      { productId: 'product-1', unitId: 'unit-1', quantity: 20, unitCost: 3 },
    ]);

    await service.post('grn-1', user);

    expect(inventoryMovements.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ unitCost: 3 }),
    );
    expect(prisma.goodsReceivedNoteLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grn-line-1' },
        data: { unitCost: 3 },
      }),
    );
  });

  it('does not create inventory movements when the GRN was already posted', async () => {
    const { service, prisma, inventoryMovements } = makeService();
    prisma.goodsReceivedNote.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.post('grn-1', user)).rejects.toThrow(
      'GRN has already been posted or is no longer postable',
    );
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
  });

  it('does not post a linked GRN when the purchase order is already received', async () => {
    const { service, prisma, inventoryMovements, approvedGrn } = makeService();
    prisma.goodsReceivedNote.findFirst.mockResolvedValueOnce({
      ...approvedGrn,
      purchaseOrderId: 'po-1',
    });
    prisma.purchaseOrder.findFirst.mockResolvedValueOnce({
      purchaseOrderNumber: 'PO-2026-000001',
      status: 'RECEIVED',
    });

    await expect(service.post('grn-1', user)).rejects.toThrow(
      'PO-2026-000001 has already been received',
    );
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
  });
});

describe('GoodsReceivedNotesService over-receipt unit guard', () => {
  it('rejects a GRN line for an ordered product received in a different unit than ordered', async () => {
    const { service, prisma, inventoryMovements, approvedGrn } = makeService();
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      ...approvedGrn,
      purchaseOrderId: 'po-1',
      lines: [{ productId: 'product-1', unitId: 'unit-2', acceptedQuantity: 5 }],
    });
    // PO ordered product-1 in unit-1 — a different unit than the GRN received,
    // which (without unit conversion) must be rejected rather than bypass the ceiling.
    prisma.purchaseOrderLine.findMany.mockResolvedValue([
      { productId: 'product-1', unitId: 'unit-1', quantity: 10, unitCost: 3 },
    ]);
    prisma.goodsReceivedNoteLine = { findMany: jest.fn().mockResolvedValue([]) };

    await expect(service.post('grn-1', user)).rejects.toThrow('Received unit does not match');
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
  });
});

describe('GoodsReceivedNotesService cost-by-unit guard', () => {
  it('does not apply the base-unit default cost when received in a non-base unit', async () => {
    const { service, prisma, inventoryMovements, approvedGrn } = makeService();
    // No PO, no line cost, received in unit-2 while the product base unit is unit-1.
    // The base-unit-denominated default (7) must NOT be applied to a different unit.
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      ...approvedGrn,
      lines: [{ id: 'grn-line-1', productId: 'product-1', unitId: 'unit-2', acceptedQuantity: 4 }],
    });

    await service.post('grn-1', user);

    expect(inventoryMovements.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: 'unit-2', unitCost: undefined }),
    );
    expect(prisma.goodsReceivedNoteLine.update).not.toHaveBeenCalled();
  });
});

describe('GoodsReceivedNotesService create DTO validation (finding #14)', () => {
  it('rejects a create payload with a negative acceptedQuantity', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.create(
        {
          companyId: 'company-1',
          branchId: 'branch-1',
          lines: [
            { productId: 'product-1', unitId: 'unit-1', acceptedQuantity: 10 },
            { productId: 'product-1', unitId: 'unit-1', acceptedQuantity: -10 },
          ],
        },
        user,
      ),
    ).rejects.toThrow(/must not be less than 0|acceptedQuantity/i);
    // The GRN was never written: validation fails before any persistence.
    expect(prisma.goodsReceivedNote.create).toBeUndefined();
  });

  it('accepts a well-formed create payload (non-negative quantities)', async () => {
    const { service } = makeService();
    const created = { id: 'grn-new', companyId: 'company-1', lines: [] };
    const prismaCreate = jest.fn().mockResolvedValue(created);
    // Wire create + the scope lookups the happy path needs.
    (service as any).prisma.goodsReceivedNote.create = prismaCreate;
    (service as any).prisma.branch = {
      findFirst: jest
        .fn()
        .mockResolvedValue({ divisionId: 'division-1', division: { companyId: 'company-1' } }),
    };

    const result = await service.create(
      {
        companyId: 'company-1',
        branchId: 'branch-1',
        lines: [{ productId: 'product-1', unitId: 'unit-1', acceptedQuantity: 10 }],
      },
      user,
    );

    expect(prismaCreate).toHaveBeenCalled();
    expect(result).toBe(created);
  });
});

describe('GoodsReceivedNotesService empty-PO ceiling (finding #26)', () => {
  it('rejects a PO-linked GRN when the purchase order has no order lines', async () => {
    const { service, prisma, inventoryMovements, approvedGrn } = makeService();
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      ...approvedGrn,
      purchaseOrderId: 'po-1',
      lines: [{ id: 'grn-line-1', productId: 'product-1', unitId: 'unit-1', acceptedQuantity: 10 }],
    });
    // PO exists and is receivable, but carries ZERO order lines.
    prisma.purchaseOrderLine.findMany.mockResolvedValue([]);

    await expect(service.post('grn-1', user)).rejects.toThrow(
      'Linked purchase order has no order lines to receive against',
    );
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
  });

  it('takes a FOR UPDATE row lock on the linked PO before evaluating the ceiling (finding #4)', async () => {
    const { service, prisma, approvedGrn } = makeService();
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      ...approvedGrn,
      purchaseOrderId: 'po-1',
    });
    prisma.purchaseOrderLine.findMany.mockResolvedValue([
      { productId: 'product-1', unitId: 'unit-1', quantity: 20, unitCost: 3 },
    ]);

    await service.post('grn-1', user);

    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('aborts when the FOR UPDATE lock finds no matching PO row', async () => {
    const { service, prisma, inventoryMovements, approvedGrn } = makeService();
    prisma.goodsReceivedNote.findFirst.mockResolvedValue({
      ...approvedGrn,
      purchaseOrderId: 'po-1',
    });
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.post('grn-1', user)).rejects.toThrow('Linked purchase order not found');
    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
  });
});

describe('GoodsReceivedNotesService non-stock product guard (finding #15)', () => {
  it('does not post a cost-less receipt for a trackInventory:true SERVICE product', async () => {
    const { service, prisma, inventoryMovements } = makeService();
    // Product is flagged trackInventory:true but typed SERVICE — the valuation
    // layer treats it as non-stock, so it must not receive a cost-less movement.
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        name: 'Service item',
        productType: 'SERVICE',
        trackInventory: true,
        baseUnitId: 'unit-1',
        defaultPurchasePrice: 7,
      },
    ]);

    await service.post('grn-1', user);

    expect(inventoryMovements.createMovement).not.toHaveBeenCalled();
  });

  it('still posts a receipt for a normal stock product (no productType)', async () => {
    const { service, inventoryMovements } = makeService();

    await service.post('grn-1', user);

    expect(inventoryMovements.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ movementType: 'PURCHASE_RECEIPT', quantity: 20 }),
    );
  });
});
