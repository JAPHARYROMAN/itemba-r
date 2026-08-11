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
        recordBookDailySale: { create: txCreate },
        recordBookSaleReceipt: { deleteMany: jest.fn() },
      }),
    ),
    ...overrides,
  };
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  };
  return {
    service: new RecordBookService(prisma, auditLogs as any, companyScope as any),
    prisma,
    auditLogs,
    companyScope,
    txCreate,
  };
}

describe('RecordBookService', () => {
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
    const { service, prisma } = makeService();
    prisma.recordBookDailySale.findFirst.mockResolvedValueOnce({ id: 'existing' });

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
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'sale-1',
        companyId: 'company-1',
        branchId: 'branch-1',
        recordDate: new Date('2026-07-09T00:00:00.000Z'),
        currency: CurrencyCode.TZS,
        status: RecordBookStatus.DRAFT,
        receipts: [],
      })
      .mockResolvedValueOnce({ id: 'replacement-sale' });
    const { service } = makeService({
      recordBookDailySale: { findFirst, update: jest.fn() },
    });

    await expect(service.restoreDailySale('sale-1', user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
