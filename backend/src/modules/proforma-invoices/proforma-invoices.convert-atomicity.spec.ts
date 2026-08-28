import { BadRequestException } from '@nestjs/common';
import { ProformaInvoicesService } from './proforma-invoices.service';

const USER = {
  id: 'user-a',
  companyId: 'company-a',
  companyAccess: [],
  roleScopes: ['COMPANY'],
} as any;

const ACCEPTED = {
  id: 'proforma-a',
  companyId: 'company-a',
  customerId: 'customer-a',
  divisionId: null,
  branchId: null,
  currency: 'TZS',
  subtotal: 100,
  discountAmount: 0,
  taxAmount: 18,
  totalAmount: 118,
  proformaNumber: 'PRF-2031-00001',
  status: 'ACCEPTED',
  convertedSalesOrderId: null,
  lines: [
    {
      productId: 'product-a',
      description: 'Widget',
      quantity: 1,
      unitId: 'unit-a',
      unitPrice: 100,
      discountAmount: 0,
      taxAmount: 18,
      lineTotal: 118,
    },
  ],
} as any;

function harness() {
  const tx = {
    proformaInvoice: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
    },
    salesOrder: { create: jest.fn().mockResolvedValue({ id: 'unused' }) },
    salesOrderLine: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  } as any;
  const prisma = {
    proformaInvoice: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(ACCEPTED)
        .mockResolvedValue({
          ...ACCEPTED,
          status: 'CONVERTED',
          convertedSalesOrderId: 'sales-order-a',
        }),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  } as any;
  const audit = { logStrictInTransaction: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new ProformaInvoicesService(prisma, audit);
  return { audit, prisma, service, tx };
}

describe('ProformaInvoicesService conversion atomicity', () => {
  it('claims, creates the order and lines, and strictly audits in one transaction', async () => {
    const { audit, prisma, service, tx } = harness();

    await service.convertToSalesOrder(ACCEPTED.id, USER);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.proformaInvoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: ACCEPTED.id,
        companyId: ACCEPTED.companyId,
        status: 'ACCEPTED',
        convertedSalesOrderId: null,
        deletedAt: null,
      },
      data: { status: 'CONVERTED' },
    });
    const orderData = tx.salesOrder.create.mock.calls[0][0].data;
    expect(orderData).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        companyId: ACCEPTED.companyId,
        idempotencyKey: `proforma:${ACCEPTED.id}`,
        paymentMethod: 'CREDIT',
        salesType: 'CREDIT_SALE',
        status: 'DRAFT',
      }),
    );
    const numberParts = orderData.salesOrderNumber.match(/^SO-(\d{4})-([0-9A-Z]+)$/);
    expect(numberParts).not.toBeNull();
    const [, year, encodedTimestamp] = numberParts!;
    expect(Number(year)).toBe(orderData.orderDate.getFullYear());
    expect(Number.parseInt(encodedTimestamp, 36)).toBe(orderData.orderDate.getTime());
    expect(tx.salesOrderLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ salesOrderId: orderData.id, productId: 'product-a' })],
    });
    expect(tx.proformaInvoice.update).toHaveBeenCalledWith({
      where: { id: ACCEPTED.id },
      data: { convertedSalesOrderId: orderData.id },
    });
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'PROFORMA_INVOICE_CONVERTED',
        entityId: ACCEPTED.id,
        companyId: ACCEPTED.companyId,
        newValue: { convertedSalesOrderId: orderData.id },
      }),
    );
    expect(tx.proformaInvoice.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.salesOrder.create.mock.invocationCallOrder[0],
    );
    expect(tx.salesOrder.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.proformaInvoice.update.mock.invocationCallOrder[0],
    );
    expect(tx.proformaInvoice.update.mock.invocationCallOrder[0]).toBeLessThan(
      audit.logStrictInTransaction.mock.invocationCallOrder[0],
    );
  });

  it('treats an already-converted proforma as an idempotent replay', async () => {
    const { audit, prisma, service, tx } = harness();
    prisma.proformaInvoice.findFirst.mockReset().mockResolvedValue({
      ...ACCEPTED,
      status: 'CONVERTED',
      convertedSalesOrderId: 'sales-order-existing',
    });

    await expect(service.convertToSalesOrder(ACCEPTED.id, USER)).resolves.toEqual(
      expect.objectContaining({ convertedSalesOrderId: 'sales-order-existing' }),
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.salesOrder.create).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('does not duplicate an order when another caller wins the conditional claim', async () => {
    const { audit, service, tx } = harness();
    tx.proformaInvoice.updateMany.mockResolvedValue({ count: 0 });
    tx.proformaInvoice.findUnique.mockResolvedValue({
      status: 'CONVERTED',
      convertedSalesOrderId: 'sales-order-winner',
    });

    await service.convertToSalesOrder(ACCEPTED.id, USER);

    expect(tx.salesOrder.create).not.toHaveBeenCalled();
    expect(tx.salesOrderLine.createMany).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('fails closed on an unexpected lost-claim state', async () => {
    const { service, tx } = harness();
    tx.proformaInvoice.updateMany.mockResolvedValue({ count: 0 });
    tx.proformaInvoice.findUnique.mockResolvedValue({
      status: 'CANCELLED',
      convertedSalesOrderId: null,
    });

    await expect(service.convertToSalesOrder(ACCEPTED.id, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.salesOrder.create).not.toHaveBeenCalled();
  });

  it('propagates strict audit failure from inside the mutation transaction', async () => {
    const { audit, service } = harness();
    const persistenceFailure = new Error('audit append unavailable');
    audit.logStrictInTransaction.mockRejectedValueOnce(persistenceFailure);

    await expect(service.convertToSalesOrder(ACCEPTED.id, USER)).rejects.toBe(persistenceFailure);
  });
});
