import { SalesCommissionsService } from './sales-commissions.service';

function authUser() {
  return {
    id: 'commission-user',
    companyId: 'company-1',
    role: { scope: 'COMPANY' },
  } as any;
}

function makeExisting(overrides: Record<string, unknown> = {}) {
  return {
    id: 'commission-1',
    companyId: 'company-1',
    employeeId: 'employee-1',
    salesOrderId: 'order-1',
    status: 'DRAFT',
    basis: 'GROSS',
    rate: 0.05,
    amount: 999,
    notes: 'original',
    salesOrder: {
      id: 'order-1',
      subtotal: 10000,
      discountAmount: 0,
      totalAmount: 11800,
    },
    ...overrides,
  };
}

function makePrisma(existing: Record<string, unknown>) {
  return {
    salesCommission: {
      findFirst: jest.fn(async () => existing),
      update: jest.fn(async (args: any) => ({ ...existing, ...args.data })),
    },
  } as any;
}

function makeService(prisma: any) {
  return new SalesCommissionsService(prisma, {
    log: jest.fn().mockResolvedValue(undefined),
  } as any);
}

describe('SalesCommissionsService update', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps the stored amount when only notes change (unchanged basis/rate resent)', async () => {
    const prisma = makePrisma(makeExisting());
    const service = makeService(prisma);

    await service.update(
      'commission-1',
      { basis: 'GROSS' as any, rate: 0.05, notes: 'updated' },
      authUser(),
    );

    const data = prisma.salesCommission.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('amount');
    expect(data.notes).toBe('updated');
  });

  it('recomputes the amount when the rate actually changes', async () => {
    const prisma = makePrisma(makeExisting());
    const service = makeService(prisma);

    await service.update('commission-1', { rate: 0.1 }, authUser());

    expect(prisma.salesCommission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'commission-1' },
        data: expect.objectContaining({ rate: 0.1, amount: 1000 }),
      }),
    );
  });
});
