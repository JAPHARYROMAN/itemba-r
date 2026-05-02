import { ComplianceDashboardService } from './compliance-dashboard.service';

function makePrisma() {
  return {
    complianceObligation: {
      count: jest
        .fn()
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(20),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ status: 'COMPLETED', _count: { _all: 20 } }])
        .mockResolvedValueOnce([{ priority: 'CRITICAL', _count: { _all: 2 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'obligation-1' }]),
    },
    complianceDocumentStatus: {
      count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(5).mockResolvedValueOnce(18),
      groupBy: jest.fn().mockResolvedValue([{ status: 'MISSING', _count: { _all: 4 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'document-status-1' }]),
    },
    taxReturn: {
      count: jest.fn().mockResolvedValueOnce(6).mockResolvedValueOnce(3),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { outstandingAmount: 90000, totalDue: 120000 } }),
      groupBy: jest.fn().mockResolvedValue([{ status: 'SUBMITTED', _count: { _all: 3 } }]),
    },
    businessLicense: {
      count: jest.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(2).mockResolvedValueOnce(1),
      groupBy: jest.fn().mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 12 } }]),
    },
    oshaRegistration: {
      count: jest.fn().mockResolvedValueOnce(9).mockResolvedValueOnce(2),
    },
    complianceEvent: {
      count: jest.fn().mockResolvedValue(11),
      findMany: jest.fn().mockResolvedValue([{ id: 'event-1' }]),
    },
  } as any;
}

describe('ComplianceDashboardService summary', () => {
  it('returns scoped compliance, tax, document, license, and OSHA metrics', async () => {
    const prisma = makePrisma();
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    };
    const service = new ComplianceDashboardService(prisma, companyScope as any);

    const result = await service.getSummary({ id: 'user-1' } as any, { companyId: 'company-1' });

    expect(result).toEqual(
      expect.objectContaining({
        totalObligations: 30,
        overdueObligations: 3,
        upcomingObligations: 8,
        missingDocuments: 4,
        openTaxReturns: 6,
        completionRate: 67,
      }),
    );
    expect(result.taxReturns.outstandingAmount).toBe(90000);
    expect(result.licenses).toEqual({
      active: 12,
      expiringWithin60Days: 2,
      expired: 1,
    });
    expect(result.osha).toEqual({ activeRegistrations: 9, expiringWithin60Days: 2 });
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith({ id: 'user-1' }, 'company-1');
  });
});
