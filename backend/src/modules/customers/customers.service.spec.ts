import { CustomersService } from './customers.service';

function makePrisma() {
  return {
    customer: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'customer-1',
        companyId: 'company-1',
        name: 'Customer One',
        customerCode: 'C001',
        creditLimit: 1000,
        currentBalance: 100,
      }),
    },
    receivable: {
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({ _sum: { outstandingAmount: 200 }, _count: { id: 2 } })
        .mockResolvedValueOnce({ _sum: { outstandingAmount: 50 }, _count: { id: 1 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    salesOrder: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: 0 }, _count: { id: 0 } }),
    },
    salesOrderLine: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    employee: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  } as any;
}

describe('CustomersService profile', () => {
  it('uses PAID receivables for recent payments', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(
      prisma,
      { log: jest.fn() } as any,
      { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any,
    );

    await service.profile('customer-1', { id: 'user-1' } as any);

    expect(prisma.receivable.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: 'customer-1',
          status: 'PAID',
        }),
      }),
    );
  });
});
