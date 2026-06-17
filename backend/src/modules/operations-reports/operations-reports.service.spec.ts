import { OperationsReportsService } from './operations-reports.service';

function makeService() {
  const prisma = {} as any;
  const companyScope = { companyWhereFor: jest.fn() } as any;
  return new OperationsReportsService(prisma, companyScope);
}

const user = { id: 'user-1' } as any;

describe('OperationsReportsService product detail reports', () => {
  it('groups sales by customer and product', async () => {
    const service = makeService();
    jest.spyOn(service, 'getSalesReport').mockResolvedValue([
      {
        salesOrderNumber: 'SO-1',
        customerCode: 'CUST-1',
        customer: 'Customer One',
        productCode: 'PRD-1',
        sku: 'SKU-1',
        product: 'Product One',
        unit: 'pcs',
        quantity: 2,
        amount: 100,
        discountAmount: 5,
        taxAmount: 0,
      },
      {
        salesOrderNumber: 'SO-2',
        customerCode: 'CUST-1',
        customer: 'Customer One',
        productCode: 'PRD-1',
        sku: 'SKU-1',
        product: 'Product One',
        unit: 'pcs',
        quantity: 3,
        amount: 180,
        discountAmount: 0,
        taxAmount: 10,
      },
    ] as any);

    await expect(service.getCustomerProductSales({}, user)).resolves.toEqual([
      expect.objectContaining({
        customerCode: 'CUST-1',
        customer: 'Customer One',
        productCode: 'PRD-1',
        product: 'Product One',
        documentCount: 2,
        lineCount: 2,
        quantity: 5,
        totalAmount: 280,
        discountAmount: 5,
        taxAmount: 10,
        averageUnitPrice: 56,
      }),
    ]);
  });

  it('groups purchases by supplier and product', async () => {
    const service = makeService();
    jest.spyOn(service, 'getPurchaseReport').mockResolvedValue([
      {
        purchaseOrderNumber: 'PO-1',
        supplierCode: 'SUPP-1',
        supplier: 'Supplier One',
        productCode: 'PRD-1',
        sku: 'SKU-1',
        product: 'Product One',
        unit: 'pcs',
        quantity: 4,
        amount: 200,
        discountAmount: 10,
        taxAmount: 0,
      },
    ] as any);

    await expect(service.getSupplierProductPurchases({}, user)).resolves.toEqual([
      expect.objectContaining({
        supplierCode: 'SUPP-1',
        supplier: 'Supplier One',
        productCode: 'PRD-1',
        product: 'Product One',
        documentCount: 1,
        lineCount: 1,
        quantity: 4,
        totalAmount: 200,
        discountAmount: 10,
        taxAmount: 0,
        averageUnitCost: 50,
      }),
    ]);
  });
});
