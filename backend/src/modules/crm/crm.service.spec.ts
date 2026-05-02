import { CrmService } from './crm.service';

function makePrisma() {
  return {
    customer: {
      count: jest
        .fn()
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(15),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { currentBalance: 125000, creditLimit: 250000 },
      }),
      groupBy: jest.fn().mockResolvedValue([
        { status: 'ACTIVE', _count: { _all: 80 } },
        { status: 'BLOCKED', _count: { _all: 5 } },
      ]),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'customer-recent' }])
        .mockResolvedValueOnce([{ id: 'customer-balance' }]),
    },
    supplier: {
      count: jest
        .fn()
        .mockResolvedValueOnce(40)
        .mockResolvedValueOnce(35)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { currentBalance: 62000, creditLimit: 100000 },
      }),
      groupBy: jest.fn().mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 35 } }]),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'supplier-recent' }])
        .mockResolvedValueOnce([{ id: 'supplier-balance' }]),
    },
    communicationLog: {
      count: jest.fn().mockResolvedValueOnce(9).mockResolvedValueOnce(4).mockResolvedValueOnce(2),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ status: 'OPEN', _count: { _all: 9 } }])
        .mockResolvedValueOnce([{ communicationType: 'EMAIL', _count: { _all: 6 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'comm-1' }]),
    },
    customerSegment: {
      count: jest.fn().mockResolvedValueOnce(6).mockResolvedValueOnce(7),
    },
    contactPerson: { count: jest.fn().mockResolvedValue(55) },
    customerCreditProfile: { count: jest.fn().mockResolvedValue(3) },
    supplierPerformanceProfile: { count: jest.fn().mockResolvedValue(2) },
  } as any;
}

describe('CrmService feature breadth summary', () => {
  it('returns customer, supplier, communication, and relationship operations metrics', async () => {
    const prisma = makePrisma();
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    };
    const service = new CrmService(prisma, { log: jest.fn() } as any, companyScope as any);

    const result = await service.getSummary({ companyId: 'company-1' }, { id: 'user-1' } as any);

    expect(result).toEqual(
      expect.objectContaining({
        totalCustomers: 100,
        totalSuppliers: 40,
        openCommunications: 9,
        activeSegments: 6,
      }),
    );
    expect(result.customers).toEqual({
      total: 100,
      active: 80,
      blocked: 5,
      inactive: 15,
      activeRate: 80,
      creditLimit: 250000,
      outstandingBalance: 125000,
    });
    expect(result.suppliers).toEqual({
      total: 40,
      active: 35,
      blocked: 2,
      inactive: 3,
      activeRate: 88,
      creditLimit: 100000,
      outstandingBalance: 62000,
    });
    expect(result.relationshipOps).toEqual({
      contactPeople: 55,
      totalSegments: 7,
      activeSegments: 6,
      openCommunications: 9,
      followUpsDue: 4,
      overdueFollowUps: 2,
      highRiskCreditProfiles: 3,
      supplierRiskProfiles: 2,
    });
    expect(result.customerStatusBreakdown).toEqual({ ACTIVE: 80, BLOCKED: 5 });
    expect(result.communicationTypeBreakdown).toEqual({ EMAIL: 6 });
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith({ id: 'user-1' }, 'company-1');
  });
});
