import { PurchaseOrdersService } from './purchase-orders.service';

function makeService() {
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    purchaseOrder: {
      create: jest.fn(async ({ data }: any) => ({ id: 'po-1', ...data, lines: [] })),
      update: jest.fn(async ({ data }: any) => ({ id: 'po-1', companyId: 'company-1', ...data })),
      findFirst: jest.fn(),
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
  const service = new PurchaseOrdersService(
    prisma,
    auditLogs,
    inventoryMovements,
    taxAutoApply,
    codes,
    companyScope,
  );

  return { service, prisma };
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

  it('repairs cash payment state when a cash purchase is received', async () => {
    const { service, prisma } = makeService();
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
        }),
      }),
    );
  });
});
