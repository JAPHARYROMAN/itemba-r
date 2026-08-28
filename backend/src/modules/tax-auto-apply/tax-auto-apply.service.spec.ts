import { TaxAutoApplyService } from './tax-auto-apply.service';

describe('TaxAutoApplyService manual audit boundary', () => {
  const previousFlag = process.env.TAX_AUTO_APPLY;

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousFlag === undefined) delete process.env.TAX_AUTO_APPLY;
    else process.env.TAX_AUTO_APPLY = previousFlag;
  });

  it.each([
    {
      invoke: (service: TaxAutoApplyService, user: any) =>
        service.applyForSalesOrder('sales-order-a', user.id, undefined, user),
      sourceDelegate: 'salesOrder',
      sourceId: 'sales-order-a',
      action: 'TAX_AUTO_APPLY_SALES_ORDER',
      entityType: 'SalesOrder',
    },
    {
      invoke: (service: TaxAutoApplyService, user: any) =>
        service.applyForPurchaseOrder('purchase-order-a', user.id, undefined, user),
      sourceDelegate: 'purchaseOrder',
      sourceId: 'purchase-order-a',
      action: 'TAX_AUTO_APPLY_PURCHASE_ORDER',
      entityType: 'PurchaseOrder',
    },
  ])(
    'fails closed by default while still recording the manual $entityType action',
    async ({ invoke, sourceDelegate, sourceId, action, entityType }) => {
      delete process.env.TAX_AUTO_APPLY;
      const sourceLookup = jest.fn().mockResolvedValue({ companyId: 'company-a' });
      const prisma = {
        salesOrder: { findUnique: jest.fn() },
        purchaseOrder: { findUnique: jest.fn() },
      } as any;
      prisma[sourceDelegate].findUnique = sourceLookup;
      const companyScope = { assertCanAccessCompany: jest.fn() } as any;
      const auditLogs = { logStrict: jest.fn().mockResolvedValue(undefined) } as any;
      const service = new TaxAutoApplyService(prisma, companyScope, auditLogs);
      const user = { id: 'user-a' } as any;

      await expect(invoke(service, user)).resolves.toEqual({
        skipped: 0,
        booked: 0,
        total: 0,
        disabled: true,
      });
      expect(companyScope.assertCanAccessCompany).not.toHaveBeenCalled();
      expect(sourceLookup).toHaveBeenCalledWith({
        where: { id: sourceId },
        select: { companyId: true },
      });
      expect(auditLogs.logStrict).toHaveBeenCalledWith({
        action,
        entityType,
        entityId: sourceId,
        userId: 'user-a',
        companyId: 'company-a',
        newValue: {
          booked: 0,
          skipped: 0,
          total: 0,
          disabled: true,
          failed: false,
        },
      });
    },
  );

  it('does not create a second audit boundary for the internal confirmation caller', async () => {
    delete process.env.TAX_AUTO_APPLY;
    const prisma = {
      salesOrder: { findUnique: jest.fn() },
      purchaseOrder: { findUnique: jest.fn() },
    } as any;
    const auditLogs = { logStrict: jest.fn() } as any;
    const service = new TaxAutoApplyService(
      prisma,
      { assertCanAccessCompany: jest.fn() } as any,
      auditLogs,
    );

    await expect(service.applyForSalesOrder('sales-order-a', 'user-a')).resolves.toEqual({
      skipped: 0,
      booked: 0,
      total: 0,
      disabled: true,
    });
    expect(prisma.salesOrder.findUnique).not.toHaveBeenCalled();
    expect(auditLogs.logStrict).not.toHaveBeenCalled();
  });
});
