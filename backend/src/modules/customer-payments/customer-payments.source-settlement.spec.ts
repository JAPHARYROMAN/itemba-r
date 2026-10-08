import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomerPaymentsService } from './customer-payments.service';

describe('Customer payment source order projection', () => {
  const canonical = {
    id: 'ar',
    sourceType: 'SalesOrder',
    sourceId: 'order',
    companyId: 'company',
    customerId: 'customer',
    currency: 'TZS',
    amount: 60,
    paidAmount: 20,
    outstandingAmount: 30,
    status: 'PARTIALLY_PAID',
  };
  function make(total = 100) {
    const tx = {
      salesOrder: {
        findFirst: jest.fn().mockResolvedValue({ totalAmount: new Prisma.Decimal(total) }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = Object.create(CustomerPaymentsService.prototype) as any;
    return { tx, sync: (row = canonical) => service.syncSalesOrderPaymentFromReceivable(tx, row) };
  }
  it('keeps unbilled source value and non-cash relief separate when a payment changes a partially billed order', async () => {
    const { tx, sync } = make();
    await sync();
    const { data, where } = tx.salesOrder.updateMany.mock.calls[0][0];
    expect(data.paidAmount.toFixed(2)).toBe('20.00');
    expect(data.outstandingAmount.toFixed(2)).toBe('70.00');
    expect(data.paymentStatus).toBe('PARTIALLY_PAID');
    expect(where).toMatchObject({ companyId: 'company', customerId: 'customer', currency: 'TZS' });
  });
  it('rejects a canonical amount exceeding the source before updating its payment snapshot', async () => {
    const { tx, sync } = make(50);
    await expect(sync()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
  });
  it('does not update an absent, cancelled, or differently scoped source order', async () => {
    const { tx, sync } = make();
    tx.salesOrder.findFirst.mockResolvedValue(null);
    await sync();
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
  });
});
