import { ProcurementService } from './procurement.service';

function makePrisma() {
  return {
    purchaseRequisition: {
      count: jest.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(3).mockResolvedValueOnce(2),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalEstimatedAmount: 50000 } }),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([
          { status: 'SUBMITTED', _count: { _all: 8 } },
          { status: 'DRAFT', _count: { _all: 4 } },
        ])
        .mockResolvedValueOnce([{ priority: 'URGENT', _count: { _all: 3 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'req-1' }]),
    },
    requestForQuotation: {
      count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(1),
      groupBy: jest.fn().mockResolvedValue([{ status: 'SENT', _count: { _all: 4 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'rfq-1' }]),
    },
    purchaseOrder: {
      count: jest.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(2),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalAmount: 250000, outstandingAmount: 110000 },
      }),
      groupBy: jest.fn().mockResolvedValue([{ status: 'CONFIRMED', _count: { _all: 7 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'po-1' }]),
    },
    goodsReceivedNote: {
      count: jest.fn().mockResolvedValue(4),
      groupBy: jest.fn().mockResolvedValue([{ status: 'RECEIVED', _count: { _all: 4 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'grn-1' }]),
    },
    supplierInvoice: {
      count: jest.fn().mockResolvedValueOnce(9).mockResolvedValueOnce(1),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalAmount: 90000, outstandingAmount: 45000 },
      }),
      groupBy: jest.fn().mockResolvedValue([{ status: 'APPROVED', _count: { _all: 6 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'invoice-1' }]),
    },
    procurementPlan: { count: jest.fn().mockResolvedValue(2) },
    threeWayMatch: { count: jest.fn().mockResolvedValue(1) },
  } as any;
}

describe('ProcurementService feature breadth summary', () => {
  it('returns requisition, RFQ, PO, receiving, invoice, and variance metrics', async () => {
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    };
    const service = new ProcurementService(
      makePrisma(),
      { log: jest.fn() } as any,
      companyScope as any,
    );

    const result = await service.getSummary({ companyId: 'company-1' }, { id: 'user-1' } as any);

    expect(result).toEqual(
      expect.objectContaining({
        openRequisitions: 12,
        pendingRfqs: 5,
        pendingGrns: 4,
        pendingInvoices: 9,
        activeProcurementPlans: 2,
      }),
    );
    expect(result.requisitions).toEqual({
      open: 12,
      urgent: 3,
      overdue: 2,
      pipelineAmount: 50000,
    });
    expect(result.rfqs).toEqual({ pending: 5, overdue: 1 });
    expect(result.purchaseOrders).toEqual({
      open: 7,
      overdue: 2,
      committedAmount: 250000,
      outstandingAmount: 110000,
    });
    expect(result.receiving).toEqual({ pendingGrns: 4, threeWayMatchVariances: 1 });
    expect(result.invoices).toEqual({
      pending: 9,
      disputed: 1,
      approvedOrDisputedAmount: 90000,
      outstandingAmount: 45000,
    });
    expect(result.requisitionStatusBreakdown).toEqual({ SUBMITTED: 8, DRAFT: 4 });
    expect(result.requisitionPriorityBreakdown).toEqual({ URGENT: 3 });
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith({ id: 'user-1' }, 'company-1');
  });
});
