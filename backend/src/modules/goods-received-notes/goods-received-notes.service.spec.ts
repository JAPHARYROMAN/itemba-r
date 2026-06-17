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
        productId: 'product-1',
        unitId: 'unit-1',
        acceptedQuantity: 20,
      },
    ],
  };

  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    goodsReceivedNote: {
      findFirst: jest.fn().mockResolvedValue(approvedGrn),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    product: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'product-1', name: 'Product 1', trackInventory: true }]),
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
