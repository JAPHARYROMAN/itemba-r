import { DashboardService } from './dashboard.service';

function makePrisma() {
  return {
    company: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'company-a',
          name: 'Company A',
          code: 'A',
          status: 'ACTIVE',
          industryType: null,
          divisions: [],
        },
      ]),
    },
    division: { count: jest.fn().mockResolvedValue(2) },
    branch: { count: jest.fn().mockResolvedValue(3) },
    user: { count: jest.fn().mockResolvedValue(4) },
    bankAccount: { count: jest.fn().mockResolvedValue(5) },
    loan: {
      count: jest.fn().mockResolvedValue(6),
      aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingBalance: 900 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    debt: {
      count: jest.fn().mockResolvedValue(7),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1000 } }),
    },
    contract: {
      count: jest.fn().mockResolvedValue(8),
      findMany: jest.fn().mockResolvedValue([]),
    },
    fixedAsset: {
      count: jest.fn().mockResolvedValue(9),
      aggregate: jest.fn().mockResolvedValue({ _sum: { currentBookValue: 2000 } }),
    },
    document: {
      count: jest.fn().mockResolvedValue(10),
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      count: jest.fn().mockResolvedValue(11),
      findMany: jest.fn().mockResolvedValue([]),
    },
    receivable: {
      count: jest.fn().mockResolvedValue(3),
      aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingAmount: 1200 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    payable: {
      count: jest.fn().mockResolvedValue(4),
      aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingAmount: 800 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    cashAccount: {
      count: jest.fn().mockResolvedValue(2),
      aggregate: jest.fn().mockResolvedValue({ _sum: { currentBalance: 5000 } }),
    },
    expense: {
      count: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 600 } }),
    },
    salesOrder: {
      count: jest.fn().mockResolvedValue(5),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: 3000 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    purchaseOrder: {
      count: jest.fn().mockResolvedValue(6),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalAmount: 1500, outstandingAmount: 700 },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    product: { count: jest.fn().mockResolvedValue(12) },
    inventoryBalance: {
      count: jest.fn().mockResolvedValue(13),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalValue: 4000, quantityOnHand: 90 },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    stockAdjustment: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
    },
    approvalRequest: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
    },
    employee: { count: jest.fn().mockResolvedValue(10) },
    purchaseRequisition: { count: jest.fn().mockResolvedValue(2) },
    requestForQuotation: { count: jest.fn().mockResolvedValue(1) },
    supplierInvoice: {
      count: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingAmount: 1300 } }),
    },
    complianceObligation: { count: jest.fn().mockResolvedValue(1) },
    taxReturn: {
      count: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingAmount: 900 } }),
    },
    fuelShift: { count: jest.fn().mockResolvedValue(1) },
    fuelNozzleReading: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { litresSold: 100, expectedAmount: 250000 },
      }),
    },
    fuelShiftCollection: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 240000 } }),
    },
  } as any;
}

describe('DashboardService executive summary', () => {
  it('applies authenticated company scope to every dashboard aggregate', async () => {
    const prisma = makePrisma();
    const scope = { companyId: { in: ['company-a'] } };
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue(scope),
    };
    const service = new DashboardService(prisma, companyScope as any);
    const user = { id: 'user-1' } as any;

    const result = await service.getExecutiveSummary(user, 'requested-company');

    expect(result.overview).toEqual({
      companies: 1,
      divisions: 2,
      branches: 3,
      activeUsers: 4,
    });
    expect(result.groupControl.loans.outstanding).toBe(900);
    expect(result.groupControl.debts.totalAmount).toBe(1000);
    expect(result.groupControl.fixedAssets.totalValue).toBe(2000);
    expect(result.finance.receivables.outstanding).toBe(1200);
    expect(result.finance.payables.outstanding).toBe(800);
    expect(result.finance.cashAccounts.balance).toBe(5000);
    expect(result.operations.salesOrders.monthRevenue).toBe(3000);
    expect(result.operations.inventory.stockValue).toBe(4000);
    expect(result.petroleum.varianceToday).toBe(-10000);
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith(user, 'requested-company');

    expect(prisma.company.count).toHaveBeenCalledWith({
      where: { deletedAt: null, id: scope.companyId },
    });
    expect(prisma.company.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      id: scope.companyId,
    });
    expect(prisma.branch.count).toHaveBeenCalledWith({
      where: { deletedAt: null, division: { companyId: scope.companyId } },
    });

    for (const fn of [
      prisma.division.count,
      prisma.user.count,
      prisma.bankAccount.count,
      prisma.loan.count,
      prisma.loan.aggregate,
      prisma.loan.findMany,
      prisma.debt.count,
      prisma.debt.aggregate,
      prisma.contract.count,
      prisma.contract.findMany,
      prisma.fixedAsset.count,
      prisma.fixedAsset.aggregate,
      prisma.document.count,
      prisma.document.findMany,
      prisma.auditLog.count,
      prisma.auditLog.findMany,
      prisma.receivable.count,
      prisma.receivable.aggregate,
      prisma.receivable.findMany,
      prisma.payable.count,
      prisma.payable.aggregate,
      prisma.payable.findMany,
      prisma.cashAccount.count,
      prisma.cashAccount.aggregate,
      prisma.expense.count,
      prisma.expense.aggregate,
      prisma.salesOrder.count,
      prisma.salesOrder.aggregate,
      prisma.salesOrder.findMany,
      prisma.purchaseOrder.count,
      prisma.purchaseOrder.aggregate,
      prisma.purchaseOrder.findMany,
      prisma.product.count,
      prisma.inventoryBalance.count,
      prisma.inventoryBalance.aggregate,
      prisma.inventoryBalance.findMany,
      prisma.stockAdjustment.count,
      prisma.stockAdjustment.findMany,
      prisma.approvalRequest.count,
      prisma.approvalRequest.findMany,
      prisma.employee.count,
      prisma.purchaseRequisition.count,
      prisma.requestForQuotation.count,
      prisma.supplierInvoice.count,
      prisma.supplierInvoice.aggregate,
      prisma.complianceObligation.count,
      prisma.taxReturn.count,
      prisma.taxReturn.aggregate,
      prisma.fuelShift.count,
      prisma.fuelNozzleReading.aggregate,
      prisma.fuelShiftCollection.aggregate,
    ]) {
      for (const [arg] of fn.mock.calls) {
        expect(arg.where.companyId).toEqual(scope.companyId);
      }
    }
  });
});
