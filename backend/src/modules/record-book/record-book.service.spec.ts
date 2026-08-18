import { BadRequestException, ConflictException } from '@nestjs/common';
import { CurrencyCode, RecordBookReceiptType, RecordBookStatus } from '@prisma/client';
import { RecordBookService } from './record-book.service';

const user: any = {
  id: 'user-1',
  permissions: [],
  roleScopes: ['GROUP'],
  companyAccess: [{ companyId: 'company-1', accessLevel: 'MANAGE' }],
};

function makeService(overrides: Record<string, unknown> = {}) {
  const txCreate = jest.fn();
  const txFindFirst = jest.fn().mockResolvedValue(null);
  const txExecuteRaw = jest.fn().mockResolvedValue(1);
  const prisma: any = {
    division: { findFirst: jest.fn().mockResolvedValue({ id: 'division-1' }) },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
    recordBookDailySale: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: txCreate,
    },
    recordBookSaleReceipt: { deleteMany: jest.fn() },
    $transaction: jest.fn(async (fn) =>
      fn({
        recordBookDailySale: { create: txCreate, findFirst: txFindFirst },
        recordBookSaleReceipt: { deleteMany: jest.fn() },
        $executeRaw: txExecuteRaw,
      }),
    ),
    ...overrides,
  };
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  };
  const organizationScope = {
    assertCanAccessScope: jest.fn().mockResolvedValue(undefined),
    recordWhereFor: jest.fn().mockResolvedValue({}),
    accessibleIds: jest.fn().mockResolvedValue({
      unrestricted: true,
      divisionIds: [],
      branchIds: [],
    }),
  };
  return {
    service: new RecordBookService(
      prisma,
      auditLogs as any,
      companyScope as any,
      organizationScope as any,
    ),
    prisma,
    auditLogs,
    companyScope,
    organizationScope,
    txCreate,
    txFindFirst,
    txExecuteRaw,
  };
}

describe('RecordBookService', () => {
  it('queries companies by their id when loading organization scope options', async () => {
    const companyFindMany = jest
      .fn()
      .mockResolvedValue([{ id: 'company-1', name: 'Company', code: 'COMP' }]);
    const divisionFindMany = jest.fn().mockResolvedValue([]);
    const branchFindMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({
      company: { findMany: companyFindMany },
      division: { findMany: divisionFindMany },
      branch: { findMany: branchFindMany },
    });

    await expect(service.scopeOptions(user)).resolves.toEqual({
      companies: [{ id: 'company-1', name: 'Company', code: 'COMP' }],
      divisions: [],
      branches: [],
    });
    expect(companyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'company-1', deletedAt: null },
      }),
    );
  });

  it('keeps dashboard totals separate by currency and counts drafts independently', async () => {
    const { service } = makeService({
      recordBookDailySale: {
        groupBy: jest.fn().mockResolvedValue([
          {
            currency: CurrencyCode.TZS,
            _sum: { totalSalesAmount: 1000 },
            _count: { _all: 1 },
          },
          {
            currency: CurrencyCode.USD,
            _sum: { totalSalesAmount: 10 },
            _count: { _all: 1 },
          },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
      recordBookExpense: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { currency: CurrencyCode.TZS, _sum: { amount: 250 }, _count: { _all: 1 } },
          ]),
        count: jest.fn().mockResolvedValue(1),
      },
      recordBookSaleReceipt: {
        findMany: jest.fn().mockResolvedValue([
          {
            receiptType: RecordBookReceiptType.CASH,
            amount: 1000,
            dailySale: { currency: CurrencyCode.TZS },
          },
          {
            receiptType: RecordBookReceiptType.CASH,
            amount: 10,
            dailySale: { currency: CurrencyCode.USD },
          },
        ]),
      },
    });

    const result = await service.summary({}, user);

    expect(result.totalRecordedSales).toBeNull();
    expect(result.netMovement).toBeNull();
    expect(result.mixedCurrency).toBe(true);
    expect(result.draftRecords).toBe(3);
    expect(result.summaryByCurrency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: CurrencyCode.TZS, netMovement: 750 }),
        expect.objectContaining({ currency: CurrencyCode.USD, netMovement: 10 }),
      ]),
    );
  });

  it('rejects daily sales when receipt split does not equal total', async () => {
    const { service } = makeService();

    await expect(
      service.createDailySale(
        {
          companyId: 'company-1',
          recordDate: '2026-07-09',
          currency: CurrencyCode.TZS,
          totalSalesAmount: 1000,
          receipts: [
            { receiptType: RecordBookReceiptType.CASH, amount: 600 },
            { receiptType: RecordBookReceiptType.MPESA, amount: 100 },
          ],
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate active daily summaries for the same branch date and currency', async () => {
    const { service, txFindFirst } = makeService();
    txFindFirst.mockResolvedValueOnce({ id: 'existing' });

    await expect(
      service.createDailySale(
        {
          companyId: 'company-1',
          branchId: 'branch-1',
          recordDate: '2026-07-09',
          currency: CurrencyCode.TZS,
          totalSalesAmount: 1000,
          receipts: [{ receiptType: RecordBookReceiptType.CASH, amount: 1000 }],
        },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates draft daily sales when the receipt split matches total', async () => {
    const { service, txCreate, auditLogs } = makeService();
    txCreate.mockResolvedValue({
      id: 'sale-1',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      recordDate: new Date('2026-07-09T00:00:00.000Z'),
      currency: CurrencyCode.TZS,
      totalSalesAmount: 1000,
      status: RecordBookStatus.DRAFT,
      notes: null,
      receipts: [{ receiptType: RecordBookReceiptType.CASH, amount: 1000 }],
      company: { id: 'company-1', name: 'Company', code: 'COMP' },
      division: null,
      branch: null,
    });

    const result = await service.createDailySale(
      {
        companyId: 'company-1',
        recordDate: '2026-07-09',
        currency: CurrencyCode.TZS,
        totalSalesAmount: 1000,
        receipts: [{ receiptType: RecordBookReceiptType.CASH, amount: 1000 }],
      },
      user,
    );

    expect(result.totalSalesAmount).toBe(1000);
    expect(result.receipts[0].amount).toBe(1000);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RECORD_BOOK_DAILY_SALE_CREATE' }),
    );
  });

  it('soft-deletes draft daily sales and keeps the audit record', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'sale-1' });
    const record = {
      id: 'sale-1',
      companyId: 'company-1',
      status: RecordBookStatus.DRAFT,
      receipts: [],
    };
    const { service, auditLogs } = makeService({
      recordBookDailySale: {
        findFirst: jest.fn().mockResolvedValue(record),
        update,
      },
    });

    await expect(service.removeDailySale('sale-1', user)).resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sale-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date), updatedById: user.id }),
      }),
    );
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RECORD_BOOK_DAILY_SALE_DELETE' }),
    );
  });

  it('does not delete finalized daily sales', async () => {
    const { service } = makeService({
      recordBookDailySale: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sale-1',
          companyId: 'company-1',
          status: RecordBookStatus.FINALIZED,
          receipts: [],
        }),
        update: jest.fn(),
      },
    });

    await expect(service.removeDailySale('sale-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects restoring a daily sale when its active date key is already occupied', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'sale-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      recordDate: new Date('2026-07-09T00:00:00.000Z'),
      currency: CurrencyCode.TZS,
      status: RecordBookStatus.DRAFT,
      receipts: [],
    });
    const { service, txFindFirst } = makeService({
      recordBookDailySale: { findFirst, update: jest.fn() },
    });
    txFindFirst.mockResolvedValueOnce({ id: 'replacement-sale' });

    await expect(service.restoreDailySale('sale-1', user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('serializes duplicate checks inside a transaction-scoped advisory lock', async () => {
    const { service, prisma, txCreate, txExecuteRaw } = makeService();
    txCreate.mockResolvedValue({
      id: 'sale-1',
      companyId: 'company-1',
      recordDate: new Date('2026-07-09T00:00:00.000Z'),
      currency: CurrencyCode.TZS,
      totalSalesAmount: 1000,
      status: RecordBookStatus.DRAFT,
      receipts: [{ receiptType: RecordBookReceiptType.CASH, amount: 1000 }],
    });

    await service.createDailySale(
      {
        companyId: 'company-1',
        recordDate: '2026-07-09',
        currency: CurrencyCode.TZS,
        totalSalesAmount: 1000,
        receipts: [{ receiptType: RecordBookReceiptType.CASH, amount: 1000 }],
      },
      user,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
  });
});
