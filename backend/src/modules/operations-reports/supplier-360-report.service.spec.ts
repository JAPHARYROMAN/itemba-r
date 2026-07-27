import { Supplier360ReportService } from './supplier-360-report.service';

function makeService() {
  const supplier = {
    id: 'supplier-1',
    companyId: 'company-1',
    supplierCode: 'SUP-001',
    name: 'Supplier One',
    legalName: 'Supplier One Limited',
    status: 'ACTIVE',
    phone: '+255700000000',
    email: 'supplier@example.com',
    address: 'Tunduma',
    tin: '100-200-300',
    vrn: null,
    paymentTerms: '30 days',
    company: { id: 'company-1', name: 'Company One', code: 'CO1' },
    division: null,
    productCategories: [],
  };
  const prisma = {
    supplier: { findFirst: jest.fn().mockResolvedValue(supplier) },
    purchaseOrder: {
      groupBy: jest.fn().mockResolvedValue([
        {
          currency: 'TZS',
          _count: { _all: 2 },
          _sum: { totalAmount: 1500, paidAmount: 500, outstandingAmount: 1000 },
        },
      ]),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    payable: {
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([
          {
            currency: 'TZS',
            _count: { _all: 1 },
            _sum: { amount: 1000, paidAmount: 0, outstandingAmount: 1000 },
          },
        ])
        .mockResolvedValueOnce([{ currency: 'TZS', _sum: { outstandingAmount: 300 } }]),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    purchaseOrderLine: {
      groupBy: jest.fn().mockResolvedValue([{ productId: 'product-1', _count: { _all: 1 } }]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  } as any;
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
  const generatedDocuments = { generateTablePdf: jest.fn() } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  return {
    service: new Supplier360ReportService(prisma, companyScope, generatedDocuments, auditLogs),
    prisma,
    companyScope,
    auditLogs,
  };
}

const user = { id: 'user-1' } as any;

describe('Supplier360ReportService', () => {
  it('returns scoped supplier totals without mixing currency metadata', async () => {
    const { service, companyScope, auditLogs } = makeService();

    const result = await service.getReport(
      { companyId: 'company-1', supplierId: 'supplier-1', section: 'OVERVIEW' },
      user,
    );

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1', 'READ');
    expect(result.supplier).toEqual(
      expect.objectContaining({
        id: 'supplier-1',
        name: 'Supplier One',
      }),
    );
    expect(result.summary.byCurrency).toEqual([
      expect.objectContaining({
        currency: 'TZS',
        purchaseOrderCount: 2,
        totalPurchased: 1500,
        payableOutstandingAmount: 1000,
        overduePayableAmount: 300,
      }),
    ]);
    expect(result.summary.uniqueProducts).toBe(1);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUPPLIER_360_REPORT_VIEW', entityId: 'supplier-1' }),
    );
  });

  it('uses the linked Procurement invoice as the authoritative purchase reference', async () => {
    const { service, prisma } = makeService();
    prisma.purchaseOrder.findMany.mockResolvedValue([
      {
        id: 'po-1',
        purchaseOrderNumber: 'PO-2026-000001',
        supplierInvoiceNumber: 'DIRECT-OLD',
        supplierInvoiceDate: new Date('2026-06-01'),
        orderDate: new Date('2026-06-02'),
        purchaseType: 'CREDIT_PURCHASE',
        status: 'RECEIVED',
        paymentStatus: 'UNPAID',
        currency: 'TZS',
        totalAmount: 1000,
        paidAmount: 0,
        outstandingAmount: 1000,
        branch: { id: 'branch-1', name: 'Main Branch', code: 'MAIN' },
        division: null,
        supplierInvoices: [
          {
            id: 'invoice-1',
            supplierInvoiceNumber: 'SUP-INV-900',
            invoiceDate: new Date('2026-06-03'),
            status: 'POSTED',
          },
        ],
        lines: [
          {
            id: 'line-1',
            productId: 'product-1',
            quantity: 2,
            unitCost: 500,
            lineTotal: 1000,
            product: { id: 'product-1', productCode: 'P-1', sku: null, name: 'Paint' },
            unit: { name: 'Piece', symbol: 'pcs' },
          },
        ],
      },
    ]);
    prisma.purchaseOrder.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    const result = await service.getReport(
      { companyId: 'company-1', supplierId: 'supplier-1', section: 'PURCHASES' },
      user,
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        purchaseOrderNumber: 'PO-2026-000001',
        invoiceNumber: 'SUP-INV-900',
        invoiceSource: 'PROCUREMENT_INVOICE',
        lineCount: 1,
        lines: [expect.objectContaining({ product: 'Paint', quantity: 2 })],
      }),
    ]);
  });

  it('maps purchase UNPAID filtering to open and overdue payable records', async () => {
    const { service, prisma } = makeService();

    await service.getReport(
      {
        companyId: 'company-1',
        supplierId: 'supplier-1',
        section: 'PAYABLES',
        paymentStatus: 'UNPAID',
      },
      user,
    );

    expect(prisma.payable.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['OPEN', 'OVERDUE'] } }),
      }),
    );
  });
});
