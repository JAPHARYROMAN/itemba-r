import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { MobilePosLiteService } from './mobile-pos-lite.service';
import { MobilePosLiteController } from './mobile-pos-lite.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';

const user: any = {
  id: 'rep',
  roleScopes: ['COMPANY'],
  permissions: ['mobile_pos_lite.use', 'mobile_pos_lite.stock_count'],
};
function fixture() {
  const terminal = {
    id: 't1',
    terminalCode: 'MPL-A',
    name: 'Till 1',
    status: 'ACTIVE',
    companyId: 'co',
    divisionId: 'dv',
    branchId: 'br',
    assignedUserId: 'rep',
    deviceSecretHash: createHash('sha256').update('secret').digest('hex'),
    company: { id: 'co', name: 'Company' },
    division: { id: 'dv', name: 'Retail' },
    branch: { id: 'br', name: 'Branch' },
    assignedUser: { id: 'rep', status: 'ACTIVE', fullName: 'Cashier' },
    salesperson: { id: 'employee' },
    paymentMethods: [],
  };
  const db: any = {
    mobilePosTerminal: { findFirst: jest.fn().mockResolvedValue(terminal) },
    salesOrder: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _count: { _all: 2 }, _sum: { totalAmount: '1800' } }),
      groupBy: jest.fn().mockResolvedValue([
        { paymentMethod: 'CASH', _count: { _all: 1 }, _sum: { totalAmount: '1000' } },
        { paymentMethod: 'MIXED', _count: { _all: 1 }, _sum: { totalAmount: '800' } },
      ]),
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            totalAmount: '800',
            posTenders: [{ method: 'CASH', amount: 300, cashAccountId: 'cash', reference: null }],
          },
        ]),
    },
    salesOrderLine: { groupBy: jest.fn().mockResolvedValue([]) },
    mobilePosPriceOverride: { findMany: jest.fn().mockResolvedValue([]) },
    paymentAllocation: {
      findMany: jest.fn().mockResolvedValue([
        { amount: new Prisma.Decimal('0.1'), customerPayment: { id: 'shared', method: 'CASH' } },
        { amount: new Prisma.Decimal('0.2'), customerPayment: { id: 'shared', method: 'CASH' } },
      ]),
    },
    refund: {
      findMany: jest.fn().mockResolvedValue([{ id: 'ref', amount: new Prisma.Decimal(100) }]),
    },
    stockAdjustment: {
      count: jest.fn().mockResolvedValue(105),
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: 'sa',
            adjustmentNumber: 'SA-1',
            status: 'PENDING_APPROVAL',
            createdAt: new Date(),
            lines: [
              { productId: 'p', countedQuantity: '0', systemQuantity: '3', varianceQuantity: '-3' },
            ],
          },
        ]),
    },
  };
  db.$transaction = jest.fn(async (work: (tx: any) => Promise<unknown>) => work(db));
  const scope: any = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
  const documents: any = {
    renderLetterheadPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')),
  };
  const service = new MobilePosLiteService(
    db,
    scope,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    documents,
    {} as any,
    {} as any,
  );
  return { service, db, documents, scope };
}
describe('Native POS daily reports and count history', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-02T00:30:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  it('sums allocations exactly, counts a shared payment once, and separates original credit from receipts', async () => {
    const { service, db } = fixture();
    const report = await service.dailySummary('MPL-A', 'secret', undefined, user);
    expect(report).toMatchObject({
      businessDate: '2026-03-02',
      grossTotal: 1800,
      initialReceipts: 1300,
      initialCredit: 500,
      collectionCount: 1,
      collectionTotal: 0.3,
      refundTotal: 100,
      netReceipts: 1200.3,
    });
    expect(report.collectionByMethod).toEqual([{ method: 'CASH', amount: 0.3, count: 1 }]);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
      timeout: 30000,
    });
    expect(db.salesOrder.aggregate.mock.calls[0][0].where).toMatchObject({
      companyId: 'co',
      divisionId: 'dv',
      branchId: 'br',
      createdById: 'rep',
      mobilePosTerminalId: 't1',
      deletedAt: null,
      orderDate: { gte: new Date('2026-03-01T21:00:00Z'), lt: new Date('2026-03-02T21:00:00Z') },
    });
    const filter = db.paymentAllocation.findMany.mock.calls[0][0];
    expect(filter.select).toEqual({
      amount: true,
      customerPayment: { select: { id: true, method: true } },
    });
    expect(filter.where.receivable.salesOrders.some).toMatchObject({
      branchId: 'br',
      createdById: 'rep',
      mobilePosTerminalId: 't1',
      deletedAt: null,
    });
    expect(filter.where.receivable.salesOrders.some.orderDate).toBeUndefined();
    expect(filter.where.customerPayment).toMatchObject({
      status: 'COMPLETED',
      deletedAt: null,
      branchId: 'br',
    });
    expect(db.refund.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'PAID',
      deletedAt: null,
      creditNote: { status: 'ISSUED', deletedAt: null },
    });
  });
  it.each(['2026-02-30', '2026-03-03', '2026-02-23', 'not-a-date'])(
    'rejects invalid/out-of-window date %s before reading totals',
    async (date) => {
      const { service, db } = fixture();
      await expect(service.dailySummary('MPL-A', 'secret', date, user)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it('uses company letterhead without creating a daily close or shift', async () => {
    const { service, documents } = fixture();
    const result = await service.dailySummaryPdf('MPL-A', 'secret', '2026-03-01', user);
    expect(result.fileName).toBe('POS-MPL-A-2026-03-01.pdf');
    expect(documents.renderLetterheadPdf).toHaveBeenCalledWith(
      { companyId: 'co', branchId: 'br' },
      expect.objectContaining({ title: 'RIPOTI YA SIKU / DAILY POS REPORT' }),
      user,
    );
  });
  it('denies count history without its action permission', async () => {
    const { service, db } = fixture();
    await expect(
      service.stockCountHistory('MPL-A', 'secret', {
        ...user,
        permissions: ['mobile_pos_lite.use'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.stockAdjustment.findMany).not.toHaveBeenCalled();
  });
  it.each(['dailySummary', 'stockCountHistory', 'stock'])(
    'rejects %s after branch write access expires',
    async (method) => {
      const { service, db } = fixture();
      const restricted = {
        ...user,
        roleScopes: ['BRANCH'],
        divisionAccess: [],
        branchAccess: [{ branchId: 'other', accessLevel: 'WRITE' }],
      };
      await expect(
        (service as any)[method](
          'MPL-A',
          'secret',
          ...(['dailySummary', 'stock'].includes(method) ? [undefined] : []),
          restricted,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(db.stockAdjustment.findMany).not.toHaveBeenCalled();
    },
  );
  it('lists zero counts, truncation and approval state without cost fields or terminal-prefix matches', async () => {
    const { service, db } = fixture();
    const report = await service.stockCountHistory('MPL-A', 'secret', user);
    expect(report).toMatchObject({
      count: 105,
      truncated: true,
      counts: [
        {
          status: 'PENDING_APPROVAL',
          lines: [{ countedQuantity: 0, systemQuantity: 3, varianceQuantity: -3 }],
        },
      ],
    });
    const query = db.stockAdjustment.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      companyId: 'co',
      divisionId: 'dv',
      branchId: 'br',
      createdById: 'rep',
      deletedAt: null,
    });
    expect(query.where.OR).toEqual([
      { notes: { contains: 'Stock count from terminal MPL-A captured ' } },
      { notes: { endsWith: 'Stock count from terminal MPL-A' } },
    ]);
    expect(query.select.lines.select).toEqual({
      productId: true,
      countedQuantity: true,
      systemQuantity: true,
      varianceQuantity: true,
    });
  });
  it('protects the new read routes with existing permissions', () => {
    for (const method of ['dailySummary', 'dailySummaryPdf'])
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, (MobilePosLiteController.prototype as any)[method]),
      ).toEqual(['mobile_pos_lite.use']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MobilePosLiteController.prototype.stockCountHistory),
    ).toEqual(['mobile_pos_lite.stock_count']);
  });
});
