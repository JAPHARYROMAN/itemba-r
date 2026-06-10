import { SalesOrdersService } from './sales-orders.service';
import { Prisma } from '@prisma/client';

function makeService() {
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    salesOrder: {
      create: jest.fn(async ({ data }: any) => ({ id: 'so-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'so-1', companyId: 'company-1', ...data })),
      findFirst: jest.fn(async () => ({
        id: 'so-1',
        companyId: 'company-1',
        salesOrderNumber: 'SO-2026-000001',
        orderDate: new Date('2026-05-30'),
        salesType: 'CREDIT_SALE',
        paymentMethod: 'CREDIT',
        cashAccountId: null,
        paidAmount: 0,
        outstandingAmount: 200,
        paymentStatus: 'UNPAID',
        receivableId: null,
        receivable: null,
        lines: [],
      })),
    },
    salesOrderLine: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    receivable: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    division: {
      findFirst: jest.fn(async () => ({ companyId: 'company-1' })),
    },
    branch: {
      findFirst: jest.fn(async () => ({
        divisionId: 'division-1',
        division: { companyId: 'company-1' },
      })),
    },
    customer: {
      findFirst: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
    },
    product: {
      findMany: jest.fn(async () => [{ id: 'product-1', companyId: 'company-1' }]),
    },
    unitOfMeasure: {
      findMany: jest.fn(async () => [{ id: 'unit-1', companyId: 'company-1' }]),
    },
    cashAccount: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const inventoryMovements = { createMovement: jest.fn().mockResolvedValue(undefined) } as any;
  const taxAutoApply = { applyForSalesOrder: jest.fn().mockResolvedValue({}) } as any;
  const codes = { next: jest.fn().mockResolvedValue('SO-2026-000001') } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  } as any;
  const postingEngine = { postLines: jest.fn().mockResolvedValue({ id: 'je-1' }) } as any;
  const accountResolver = { resolveMany: jest.fn() } as any;
  const service = new SalesOrdersService(
    prisma,
    auditLogs,
    inventoryMovements,
    taxAutoApply,
    codes,
    companyScope,
    postingEngine,
    accountResolver,
  );

  return { service, prisma };
}

const user = { id: 'user-1', permissions: ['sales.create'] } as any;

function createDto(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    customerName: 'Walk-in Customer',
    salesType: 'CASH_SALE',
    orderDate: '2026-05-30',
    currency: 'TZS',
    paymentMethod: 'CREDIT',
    lines: [
      {
        productId: 'product-1',
        description: 'Item',
        quantity: 2,
        unitId: 'unit-1',
        unitPrice: 100,
        discountAmount: 0,
        taxAmount: 0,
      },
    ],
    ...overrides,
  } as any;
}

describe('SalesOrdersService payment normalization', () => {
  it('does not allow a CASH_SALE to be created as a credit receivable', async () => {
    const { service } = makeService();

    await expect(service.create(createDto(), user)).rejects.toThrow(
      'Receipt account is required for non-credit sales',
    );
  });

  it('normalizes CREDIT_SALE to credit and clears receipt account fields', async () => {
    const { service, prisma } = makeService();

    await service.create(
      createDto({
        salesType: 'CREDIT_SALE',
        paymentMethod: 'CASH',
        cashAccountId: 'cash-account-1',
      }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentMethod: 'CREDIT',
          cashAccountId: null,
        }),
      }),
    );
  });
});

describe('SalesOrdersService quick-sale CREDIT handling', () => {
  it('mobilePosQuickSale preserves CREDIT (no coercion to CASH)', async () => {
    const { service, prisma } = makeService();
    // Stub confirm() so we isolate the create payload (CREDIT confirm posts a
    // receivable via a heavier path covered elsewhere).
    jest.spyOn(service, 'confirm').mockResolvedValue({ id: 'so-1' } as any);

    await service.mobilePosQuickSale(
      createDto({ salesType: 'CREDIT_SALE', paymentMethod: 'CREDIT', customerName: 'Walk-in' }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentMethod: 'CREDIT', cashAccountId: null }),
      }),
    );
  });

  it('quickSale still coerces CREDIT to CASH for the generic counter-sale flow', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service, 'confirm').mockResolvedValue({ id: 'so-1' } as any);
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountType: 'CASH_ON_HAND',
    });

    await service.quickSale(
      createDto({
        salesType: 'CASH_SALE',
        paymentMethod: 'CREDIT',
        cashAccountId: 'cash-account-1',
      }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentMethod: 'CASH', cashAccountId: 'cash-account-1' }),
      }),
    );
  });
});

describe('SalesOrdersService quick-sale idempotency', () => {
  it('replays the existing order and skips create when the idempotency key matches', async () => {
    const { service, prisma } = makeService();
    const confirmSpy = jest.spyOn(service, 'confirm');

    const result = await service.mobilePosQuickSale(
      createDto({ idempotencyKey: 'idem-1' }),
      user,
    );

    // Replay short-circuits before create()/confirm().
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: 'so-1' }));
    expect(prisma.salesOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          idempotencyKey: 'idem-1',
          deletedAt: null,
        }),
      }),
    );
  });

  it('recovers from a concurrent P2002 race by replaying the winning order', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service, 'confirm').mockResolvedValue({ id: 'so-1' } as any);
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountType: 'CASH_ON_HAND',
    });

    const winner = {
      id: 'so-1',
      companyId: 'company-1',
      salesOrderNumber: 'SO-2026-000001',
      orderDate: new Date('2026-05-30'),
      salesType: 'CASH_SALE',
      paymentMethod: 'CASH',
      cashAccountId: 'cash-account-1',
      paidAmount: 200,
      outstandingAmount: 0,
      paymentStatus: 'PAID',
      receivableId: null,
      receivable: null,
      lines: [],
    };
    // Pre-create replay misses; create() loses the unique-index race; the
    // post-create replay (and the findOne it triggers) return the winner.
    prisma.salesOrder.findFirst.mockResolvedValueOnce(null).mockResolvedValue(winner);
    prisma.salesOrder.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    const result = await service.mobilePosQuickSale(
      createDto({
        salesType: 'CASH_SALE',
        paymentMethod: 'CASH',
        cashAccountId: 'cash-account-1',
        idempotencyKey: 'idem-1',
      }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ id: 'so-1' }));
  });
});
