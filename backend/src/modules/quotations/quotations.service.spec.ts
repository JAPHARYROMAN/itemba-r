import { BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { QuotationsService } from './quotations.service';

function acceptedQuotation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quote-1',
    quotationNumber: 'QUO-2026-000001',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    customerId: 'customer-1',
    customerName: 'Acme Ltd',
    currency: 'TZS',
    status: 'ACCEPTED',
    subtotal: 100000,
    discountAmount: 0,
    taxAmount: 18000,
    totalAmount: 118000,
    lines: [
      {
        id: 'qline-1',
        productId: 'product-1',
        description: 'Widget',
        quantity: 10,
        unitId: 'unit-1',
        unitPrice: 10000,
        discountAmount: 0,
        taxAmount: 18000,
        lineTotal: 118000,
      },
    ],
    ...overrides,
  };
}

function makeService(quotationOverrides: Record<string, unknown> = {}) {
  const quotationRow = acceptedQuotation(quotationOverrides);

  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    quotation: {
      findFirst: jest.fn(async () => quotationRow),
      create: jest.fn(async ({ data }: any) => ({ id: 'quote-1', ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async ({ data }: any) => ({
        id: 'quote-1',
        companyId: 'company-1',
        ...data,
      })),
    },
    salesOrder: {
      create: jest.fn(async ({ data }: any) => ({ id: 'so-1', ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    salesOrderLine: {
      createMany: jest.fn(),
    },
    quotationLine: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const auditLogs = { log: jest.fn(async () => undefined) };
  const codes = { next: jest.fn(async () => 'SO-2026-000001') };
  const companyScope = { assertCanAccessCompany: jest.fn() };
  const salesOrders = { confirm: jest.fn(async () => ({ id: 'so-1', status: 'CONFIRMED' })) };

  const service = new QuotationsService(
    prisma,
    auditLogs as any,
    codes as any,
    companyScope as any,
    salesOrders as any,
  );

  return { service, prisma, auditLogs, codes, companyScope, salesOrders, quotationRow };
}

const user: any = { id: 'user-1', permissions: [], companyId: 'company-1' };

describe('QuotationsService.convertToSalesOrder', () => {
  it('creates a DRAFT credit sales order and routes it through confirm() so the GL/AR/stock post', async () => {
    const { service, prisma, salesOrders } = makeService();

    await service.convertToSalesOrder('quote-1', user);

    // The sales order must be DRAFT (never CONFIRMED directly) so confirm() runs.
    const createArgs = prisma.salesOrder.create.mock.calls[0][0].data;
    expect(createArgs.status).toBe('DRAFT');
    // Quotations carry no cash-account/payment data, so the order settles on
    // credit: confirm() posts DR AR / CR Revenue / CR VAT (+ DR COGS / CR Inventory).
    expect(createArgs.salesType).toBe('CREDIT_SALE');
    expect(createArgs.paymentMethod).toBe('CREDIT');
    expect(Number(createArgs.totalAmount)).toBe(118000);
    expect(Number(createArgs.outstandingAmount)).toBe(118000);

    // The lines are copied onto the sales order.
    expect(prisma.salesOrderLine.createMany).toHaveBeenCalledTimes(1);

    // The whole point of the fix: the DRAFT order is confirmed, producing the
    // journal entry, receivable, and stock issue atomically.
    expect(salesOrders.confirm).toHaveBeenCalledTimes(1);
    expect(salesOrders.confirm).toHaveBeenCalledWith('so-1', user);
  });

  it('claims the quotation ACCEPTED -> CONVERTED with a guarded updateMany (double-convert race)', async () => {
    const { service, prisma } = makeService();

    await service.convertToSalesOrder('quote-1', user);

    expect(prisma.quotation.updateMany).toHaveBeenCalledTimes(1);
    const claim = prisma.quotation.updateMany.mock.calls[0][0];
    expect(claim.where.status).toBe('ACCEPTED');
    expect(claim.data.status).toBe('CONVERTED');
  });

  it('throws (and does not create an order or confirm) when the guarded claim matches 0 rows', async () => {
    const { service, prisma, salesOrders } = makeService();
    prisma.quotation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.convertToSalesOrder('quote-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(salesOrders.confirm).not.toHaveBeenCalled();
  });

  it('rejects conversion of a non-ACCEPTED quotation before any write', async () => {
    const { service, prisma, salesOrders } = makeService();
    prisma.quotation.findFirst.mockResolvedValueOnce(acceptedQuotation({ status: 'DRAFT' }));

    await expect(service.convertToSalesOrder('quote-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(prisma.quotation.updateMany).not.toHaveBeenCalled();
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(salesOrders.confirm).not.toHaveBeenCalled();
  });

  it('enforces WRITE company scope on the quotation before converting', async () => {
    const { service, companyScope } = makeService();

    await service.convertToSalesOrder('quote-1', user);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company-1',
      AccessLevel.WRITE,
    );
  });

  describe('confirm() failure — compensating action (atomicity)', () => {
    it('rethrows the ORIGINAL confirm() error so the caller sees the real cause', async () => {
      const { service, salesOrders } = makeService();
      const boom = new BadRequestException('Cannot confirm in a closed period');
      salesOrders.confirm.mockRejectedValueOnce(boom);

      await expect(service.convertToSalesOrder('quote-1', user)).rejects.toBe(boom);
    });

    it('reverts the quotation CONVERTED -> ACCEPTED and unlinks the order (guarded/idempotent)', async () => {
      const { service, prisma, salesOrders } = makeService();
      salesOrders.confirm.mockRejectedValueOnce(new BadRequestException('insufficient stock'));

      await expect(service.convertToSalesOrder('quote-1', user)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      // The compensating quotation revert is the guarded updateMany call that
      // targets the row we just claimed (CONVERTED + pointing at this order).
      const revert = prisma.quotation.updateMany.mock.calls.find(
        ([arg]: any[]) => arg?.data?.status === 'ACCEPTED',
      );
      expect(revert).toBeDefined();
      expect(revert[0].where).toMatchObject({
        id: 'quote-1',
        companyId: 'company-1',
        status: 'CONVERTED',
        convertedSalesOrderId: 'so-1',
      });
      expect(revert[0].data).toMatchObject({ status: 'ACCEPTED', convertedSalesOrderId: null });
    });

    it('soft-deletes the just-created DRAFT sales order (guarded on status DRAFT + not deleted)', async () => {
      const { service, prisma, salesOrders } = makeService();
      salesOrders.confirm.mockRejectedValueOnce(new BadRequestException('no branchId'));

      await expect(service.convertToSalesOrder('quote-1', user)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(prisma.salesOrder.updateMany).toHaveBeenCalledTimes(1);
      const del = prisma.salesOrder.updateMany.mock.calls[0][0];
      expect(del.where).toMatchObject({
        id: 'so-1',
        companyId: 'company-1',
        status: 'DRAFT',
        deletedAt: null,
      });
      expect(del.data.deletedAt).toBeInstanceOf(Date);
    });

    it('still rethrows the confirm() error even if the compensation itself fails', async () => {
      const { service, prisma, salesOrders } = makeService();
      const boom = new BadRequestException('closed period');
      salesOrders.confirm.mockRejectedValueOnce(boom);
      // Make the compensation transaction blow up: the original error must survive.
      prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(prisma)); // Phase 1 ok
      prisma.$transaction.mockRejectedValueOnce(new Error('db down during compensation'));

      await expect(service.convertToSalesOrder('quote-1', user)).rejects.toBe(boom);
    });
  });
});


// ─── Ad-hoc (manual) lines ────────────────────────────────────────────────────
//
// A quotation may price something the catalogue does not carry yet. These tests
// pin both halves of that: what the line editor is allowed to send, and the
// boundary at conversion where "not in the catalogue" stops being acceptable.

const baseDto: any = {
  companyId: 'company-1',
  quotationType: 'GENERAL',
  quotationDate: '2026-08-20',
  currency: 'TZS',
  lines: [],
};

describe('QuotationsService.create - ad-hoc lines', () => {
  it('stores a line that has only free text, with no product or unit', async () => {
    const { service, prisma } = makeService();

    await service.create(
      { ...baseDto, lines: [{ itemName: 'Site clearing', unitLabel: 'trip', quantity: 2, unitPrice: 50000 }] },
      user,
    );

    const [line] = prisma.quotationLine.createMany.mock.calls[0][0].data;
    expect(line.productId).toBeNull();
    expect(line.unitId).toBeNull();
    expect(line.itemName).toBe('Site clearing');
    expect(line.unitLabel).toBe('trip');
    // It still prices like any other line.
    expect(Number(line.lineTotal)).toBe(100000);
  });

  it('drops itemName/unitLabel on a catalogue line so the two cannot drift apart', async () => {
    const { service, prisma } = makeService();

    await service.create(
      {
        ...baseDto,
        lines: [
          {
            productId: '11111111-1111-1111-1111-111111111111',
            unitId: 'unit-1',
            itemName: 'stale name typed before picking the product',
            unitLabel: 'stale unit',
            quantity: 1,
            unitPrice: 1000,
          },
        ],
      },
      user,
    );

    const [line] = prisma.quotationLine.createMany.mock.calls[0][0].data;
    expect(line.productId).toBe('11111111-1111-1111-1111-111111111111');
    expect(line.itemName).toBeNull();
    expect(line.unitLabel).toBeNull();
  });

  it('treats an empty-string productId as absent rather than storing it', async () => {
    const { service, prisma } = makeService();

    // The line editor sends '' for an untouched <select>. '' satisfies no foreign
    // key and reads as neither set nor unset, so it must normalise to NULL.
    await service.create(
      { ...baseDto, lines: [{ productId: '', unitId: '', itemName: 'Transport', quantity: 1, unitPrice: 5000 }] },
      user,
    );

    const [line] = prisma.quotationLine.createMany.mock.calls[0][0].data;
    expect(line.productId).toBeNull();
    expect(line.unitId).toBeNull();
  });

  it('rejects a line that names neither a product nor an item, and says which line', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.create(
        {
          ...baseDto,
          lines: [
            { itemName: 'Fine', quantity: 1, unitPrice: 1 },
            { quantity: 1, unitPrice: 1 },
          ],
        },
        user,
      ),
    ).rejects.toThrow(/Line 2/);
    expect(prisma.quotationLine.createMany).not.toHaveBeenCalled();
  });

  it('still requires a unit on a catalogue line', async () => {
    const { service } = makeService();

    await expect(
      service.create(
        {
          ...baseDto,
          lines: [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1, unitPrice: 1 }],
        },
        user,
      ),
    ).rejects.toThrow(/Line 1: a product line needs a unit/);
  });

  it('rejects a non-positive quantity', async () => {
    const { service } = makeService();

    await expect(
      service.create({ ...baseDto, lines: [{ itemName: 'Ghost', quantity: 0, unitPrice: 10 }] }, user),
    ).rejects.toThrow(/quantity must be greater than zero/);
  });
});

describe('QuotationsService.convertToSalesOrder - ad-hoc lines', () => {
  function withAdHocLine() {
    return makeService({
      lines: [
        {
          id: 'qline-1',
          productId: 'product-1',
          description: 'Widget',
          quantity: 10,
          unitId: 'unit-1',
          unitPrice: 10000,
          discountAmount: 0,
          taxAmount: 18000,
          lineTotal: 118000,
        },
        {
          id: 'qline-2',
          productId: null,
          itemName: 'Site clearing',
          quantity: 2,
          unitId: null,
          unitLabel: 'trip',
          unitPrice: 50000,
          discountAmount: 0,
          taxAmount: 0,
          lineTotal: 100000,
        },
      ],
    });
  }

  it('refuses to convert while any line is not in the catalogue', async () => {
    const { service } = withAdHocLine();

    // sales_order_lines.productId is NOT NULL and confirm() issues stock and posts
    // COGS against a real product. An item that does not exist has neither.
    await expect(service.convertToSalesOrder('quote-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('names the offending items so the user knows what to add to the catalogue', async () => {
    const { service } = withAdHocLine();

    await expect(service.convertToSalesOrder('quote-1', user)).rejects.toThrow(/Site clearing/);
  });

  it('refuses BEFORE claiming the quotation, leaving it convertible after the fix', async () => {
    const { service, prisma, salesOrders } = withAdHocLine();

    await expect(service.convertToSalesOrder('quote-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // Nothing was claimed, created or confirmed: the quotation is still ACCEPTED
    // and the user can add the products and convert for real.
    expect(prisma.quotation.updateMany).not.toHaveBeenCalled();
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(salesOrders.confirm).not.toHaveBeenCalled();
  });

  it('converts normally when every line resolves to a product', async () => {
    const { service, salesOrders } = makeService();

    await service.convertToSalesOrder('quote-1', user);

    expect(salesOrders.confirm).toHaveBeenCalledTimes(1);
  });
});
