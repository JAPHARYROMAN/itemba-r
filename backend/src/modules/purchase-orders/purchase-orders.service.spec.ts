import { PurchaseOrdersService } from './purchase-orders.service';

function makeService() {
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    purchaseOrder: {
      create: jest.fn(async ({ data }: any) => ({ id: 'po-1', ...data, lines: [] })),
      update: jest.fn(async ({ data }: any) => ({ id: 'po-1', companyId: 'company-1', ...data })),
      findFirst: jest.fn(),
    },
    payable: {
      create: jest.fn(async ({ data }: any) => ({ id: 'payable-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'payable-1', ...data })),
    },
    purchaseOrderLine: {
      deleteMany: jest.fn(),
    },
    division: {
      findFirst: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    },
    branch: {
      findFirst: jest.fn().mockResolvedValue({
        divisionId: 'division-1',
        division: { companyId: 'company-1' },
      }),
    },
    supplier: {
      findFirst: jest.fn(),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([{ id: 'product-1', companyId: 'company-1' }]),
      findUnique: jest.fn().mockResolvedValue({ id: 'product-1', trackInventory: false }),
    },
    fuelTank: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: any) => ({ id: 'tank-1', ...data })),
    },
    fuelDelivery: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 'fuel-delivery-1', ...data })),
    },
    unitOfMeasure: {
      findMany: jest.fn().mockResolvedValue([{ id: 'unit-1', companyId: 'company-1' }]),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const inventoryMovements = { createMovement: jest.fn().mockResolvedValue(undefined) } as any;
  const taxAutoApply = { applyForPurchaseOrder: jest.fn().mockResolvedValue({}) } as any;
  const codes = { next: jest.fn().mockResolvedValue('PO-2026-000001') } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  } as any;
  const postingEngine = { postLines: jest.fn().mockResolvedValue({ id: 'je-1' }) } as any;
  const accountResolver = {
    resolveMany: jest.fn().mockResolvedValue({
      INVENTORY_ASSET: { id: 'inventory-account' },
      AP_CONTROL: { id: 'ap-account' },
      CASH_ON_HAND: { id: 'cash-account' },
    }),
  } as any;
  const service = new PurchaseOrdersService(
    prisma,
    auditLogs,
    inventoryMovements,
    taxAutoApply,
    codes,
    companyScope,
    postingEngine,
    accountResolver,
  );

  return { service, prisma, postingEngine, accountResolver, inventoryMovements, codes };
}

const user = { id: 'user-1', permissions: ['purchases.create'] } as any;

function createDto(purchaseType: 'CASH_PURCHASE' | 'CREDIT_PURCHASE') {
  return {
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    supplierName: 'Supplier Ltd',
    purchaseType,
    orderDate: '2026-05-28',
    currency: 'TZS',
    lines: [
      {
        productId: 'product-1',
        description: 'Item',
        quantity: 2,
        unitId: 'unit-1',
        unitCost: 100,
        discountAmount: 0,
        taxAmount: 0,
      },
    ],
  } as any;
}

describe('PurchaseOrdersService payment state', () => {
  it('marks cash purchases paid immediately', async () => {
    const { service, prisma } = makeService();

    await service.create(createDto('CASH_PURCHASE'), user);

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 200,
          paidAmount: 200,
          outstandingAmount: 0,
          paymentStatus: 'PAID',
        }),
      }),
    );
  });

  it('keeps credit purchases unpaid with the full outstanding balance', async () => {
    const { service, prisma } = makeService();

    await service.create(createDto('CREDIT_PURCHASE'), user);

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 200,
          paidAmount: 0,
          outstandingAmount: 200,
          paymentStatus: 'UNPAID',
        }),
      }),
    );
  });

  it('rejects discounts greater than the purchase line amount', async () => {
    const { service } = makeService();
    const dto = createDto('CASH_PURCHASE');
    dto.lines[0].discountAmount = 250;

    await expect(service.create(dto, user)).rejects.toThrow(
      'Purchase order line discount cannot exceed the line amount',
    );
  });

  it('repairs cash payment state when a cash purchase is received', async () => {
    const { service, prisma, postingEngine, accountResolver } = makeService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 9400000,
      status: 'CONFIRMED',
      lines: [],
    });

    await service.receive('po-1', user);

    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1' },
        data: expect.objectContaining({
          status: 'RECEIVED',
          paidAmount: 9400000,
          outstandingAmount: 0,
          paymentStatus: 'PAID',
          journalEntryId: 'je-1',
        }),
      }),
    );
    expect(accountResolver.resolveMany).toHaveBeenCalledWith(
      'company-1',
      ['INVENTORY_ASSET', 'CASH_ON_HAND'],
      prisma,
    );
    expect(postingEngine.postLines).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        referenceType: 'PurchaseOrder',
        referenceId: 'po-1',
      }),
      prisma,
    );
  });

  it('posts received fuel purchase lines into the matching petroleum tank', async () => {
    const { service, prisma, inventoryMovements, codes } = makeService();
    prisma.product.findUnique.mockResolvedValue({ id: 'product-1', trackInventory: true });
    prisma.fuelTank.findMany.mockResolvedValue([
      { id: 'tank-1', tankCode: 'DIESEL-1', tankName: 'Diesel Tank 1' },
    ]);
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-000001',
      companyId: 'company-1',
      branchId: 'branch-1',
      divisionId: 'division-1',
      supplierId: 'supplier-1',
      supplierName: 'Fuel Supplier Ltd',
      purchaseType: 'CASH_PURCHASE',
      totalAmount: 2000000,
      expectedDate: null,
      currency: 'TZS',
      status: 'CONFIRMED',
      payableId: null,
      lines: [
        {
          productId: 'product-1',
          quantity: 1000,
          unitId: 'unit-1',
          unitCost: 2000,
          lineTotal: 2000000,
          batchNumber: null,
          expiryDate: null,
        },
      ],
    });

    await service.receive('po-1', user);

    expect(inventoryMovements.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        movementType: 'PURCHASE_RECEIPT',
        quantity: 1000,
        referenceType: 'PurchaseOrder',
        referenceId: 'po-1',
        branchId: 'branch-1',
      }),
    );
    expect(prisma.fuelDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purchaseOrderId: 'po-1',
          tankId: 'tank-1',
          productId: 'product-1',
          acceptedLitres: 1000,
          status: 'POSTED',
          postedById: 'user-1',
        }),
      }),
    );
    expect(prisma.fuelTank.update).toHaveBeenCalledWith({
      where: { id: 'tank-1' },
      data: { currentBookBalance: { increment: 1000 } },
    });
    expect(codes.next).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'FuelDelivery', companyId: 'company-1' }),
    );
  });
});
