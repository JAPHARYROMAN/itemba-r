import { Prisma, DebtStatus } from '@prisma/client';
import { DebtsService } from './debts.service';

/**
 * Builds a DebtsService with a mocked Prisma so we can assert the where-clauses
 * and aggregate math used by getSummary.
 */
function makeService() {
  const debt = {
    count: jest.fn(async () => 0),
    aggregate: jest.fn(async () => ({ _sum: { amount: null, amountPaid: null } })),
    findMany: jest.fn(async () => []),
  };
  const prisma = { debt } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    accessibleCompanyIds: jest.fn().mockResolvedValue(null),
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new DebtsService(prisma, auditLogs, companyScope);
  return { service, prisma, companyScope };
}

const user = { id: 'user-1' } as any;

describe('DebtsService.getSummary', () => {
  it('includes PARTIALLY_PAID debts in the outstanding filters', async () => {
    const { service, prisma } = makeService();
    await service.getSummary(user);

    // The outstanding count filter must cover OUTSTANDING and PARTIALLY_PAID.
    const outstandingCountCall = prisma.debt.count.mock.calls.find(
      ([arg]: any[]) => arg?.where?.status?.in,
    );
    expect(outstandingCountCall).toBeDefined();
    expect(outstandingCountCall[0].where.status.in).toEqual(
      expect.arrayContaining([DebtStatus.OUTSTANDING, DebtStatus.PARTIALLY_PAID]),
    );

    // The outstanding aggregate must sum both amount and amountPaid.
    const outstandingAggCall = prisma.debt.aggregate.mock.calls.find(
      ([arg]: any[]) => arg?.where?.status?.in && arg?._sum?.amountPaid,
    );
    expect(outstandingAggCall).toBeDefined();
    expect(outstandingAggCall[0]._sum).toEqual({ amount: true, amountPaid: true });
  });

  it('nets amountPaid off amount for totalOutstandingAmount', async () => {
    const { service, prisma } = makeService();
    // Two owed debts: 1,000,000 (paid 400,000) partial + 500,000 (paid 100,000)
    // outstanding => gross 1,500,000, paid 500,000, owed 1,000,000.
    prisma.debt.aggregate.mockImplementation(async ({ _sum }: any) => {
      if (_sum.amountPaid) {
        return {
          _sum: {
            amount: new Prisma.Decimal(1_500_000),
            amountPaid: new Prisma.Decimal(500_000),
          },
        };
      }
      return { _sum: { amount: new Prisma.Decimal(1_500_000) } };
    });

    const result = await service.getSummary(user);
    expect(new Prisma.Decimal(result.totalOutstandingAmount).toString()).toBe('1000000');
  });

  it('returns zero owed when nothing is outstanding', async () => {
    const { service } = makeService();
    const result = await service.getSummary(user);
    expect(new Prisma.Decimal(result.totalOutstandingAmount).toString()).toBe('0');
  });
});

describe('DebtsService.getOverdue', () => {
  it('returns both OUTSTANDING and PARTIALLY_PAID overdue debts in company scope', async () => {
    const { service, prisma, companyScope } = makeService();
    companyScope.accessibleCompanyIds.mockResolvedValue(['company-1']);

    await service.getOverdue(user);

    expect(prisma.debt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          status: {
            in: [DebtStatus.OUTSTANDING, DebtStatus.PARTIALLY_PAID],
          },
          dueDate: { lt: expect.any(Date) },
          companyId: { in: ['company-1'] },
        }),
      }),
    );
  });
});
