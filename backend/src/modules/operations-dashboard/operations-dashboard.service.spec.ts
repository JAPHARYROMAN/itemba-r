import { OperationsDashboardService } from './operations-dashboard.service';

function makeService() {
  const prisma = {
    product: {
      count: jest.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(10),
      findMany: jest.fn().mockResolvedValue([]),
    },
    customer: { count: jest.fn().mockResolvedValue(5) },
    supplier: { count: jest.fn().mockResolvedValue(3) },
    cashAccount: {
      count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1),
    },
    inventoryBalance: { count: jest.fn().mockResolvedValue(0) },
    inventoryMovement: { count: jest.fn().mockResolvedValue(7) },
    purchaseOrder: {
      count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(1),
    },
    salesOrder: {
      count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(1),
    },
    stockAdjustment: {
      count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0),
    },
  } as any;
  const companyScope = {
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  } as any;
  return {
    service: new OperationsDashboardService(prisma, companyScope),
    prisma,
    companyScope,
  };
}

describe('OperationsDashboardService readiness', () => {
  it('returns production-ready score when operational controls are healthy', async () => {
    const { service } = makeService();

    const readiness = await service.getReadiness('company-1', { id: 'user-1' } as any);

    expect(readiness.score).toBeGreaterThanOrEqual(90);
    expect(readiness.target).toBe(90);
    expect(readiness.checks).toHaveLength(6);
    expect(readiness.indicators.transactionIntegrityIssues).toBe(0);
  });
});
