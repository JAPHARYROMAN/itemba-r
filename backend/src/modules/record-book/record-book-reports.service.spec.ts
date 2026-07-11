import { CurrencyCode, RecordBookReceiptType, RecordBookStatus } from '@prisma/client';
import { RecordBookReportsService } from './record-book-reports.service';

const user: any = {
  id: 'user-1',
  permissions: ['record_book.view', 'record_book.export'],
  roleScopes: ['GROUP'],
  companyAccess: [{ companyId: 'company-1', accessLevel: 'MANAGE' }],
};

function makeReportsService(sales: any[] = [], expenses: any[] = []) {
  const prisma: any = {
    recordBookDailySale: { findMany: jest.fn().mockResolvedValue(sales) },
    recordBookExpense: { findMany: jest.fn().mockResolvedValue(expenses) },
  };
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
  const companyScope = {
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  };
  const generatedDocuments = {
    generateTablePdf: jest.fn().mockResolvedValue({
      buffer: Buffer.from('%PDF-report'),
      fileName: 'record-book-report.pdf',
    }),
  };
  return {
    service: new RecordBookReportsService(
      prisma,
      auditLogs as any,
      companyScope as any,
      generatedDocuments as any,
    ),
    prisma,
    auditLogs,
    generatedDocuments,
  };
}

function sale(id: string, currency: CurrencyCode, cash: number, bank: number) {
  return {
    id,
    companyId: 'company-1',
    divisionId: null,
    branchId: 'branch-1',
    recordDate: new Date('2026-07-09T00:00:00.000Z'),
    currency,
    status: RecordBookStatus.FINALIZED,
    totalSalesAmount: cash + bank,
    company: { id: 'company-1', name: 'Company', code: 'COMP' },
    division: null,
    branch: { id: 'branch-1', name: 'Main', code: 'MAIN' },
    receipts: [
      { receiptType: RecordBookReceiptType.CASH, label: 'Cash', amount: cash },
      { receiptType: RecordBookReceiptType.BANK, label: 'CRDB', amount: bank },
    ],
  };
}

describe('RecordBookReportsService', () => {
  it('defaults reports to finalized entries and aggregates receipt methods', async () => {
    const { service, prisma, auditLogs } = makeReportsService([
      sale('sale-1', CurrencyCode.TZS, 500, 300),
      sale('sale-2', CurrencyCode.TZS, 200, 0),
    ]);

    const result = await service.run('receipt-methods', { companyId: 'company-1' }, user);

    expect(prisma.recordBookDailySale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: RecordBookStatus.FINALIZED }),
      }),
    );
    expect(result.reportStatus).toBe('FINALIZED');
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'CASH',
          amount: 700,
          recordCount: 2,
          currency: CurrencyCode.TZS,
        }),
        expect.objectContaining({ method: 'BANK', amount: 300, currency: CurrencyCode.TZS }),
      ]),
    );
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RECORD_BOOK_REPORT_RUN' }),
    );
  });

  it('keeps different currencies in separate report summaries', async () => {
    const { service } = makeReportsService([
      sale('sale-tzs', CurrencyCode.TZS, 1000, 0),
      sale('sale-usd', CurrencyCode.USD, 10, 0),
    ]);

    const result = await service.run('daily-sales', {}, user);

    expect(result.summaryByCurrency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: CurrencyCode.TZS, recordedSales: 1000 }),
        expect.objectContaining({ currency: CurrencyCode.USD, recordedSales: 10 }),
      ]),
    );
  });

  it('builds daily net movement from independent sales and expenses', async () => {
    const expense = {
      id: 'expense-1',
      companyId: 'company-1',
      divisionId: null,
      branchId: 'branch-1',
      recordDate: new Date('2026-07-09T00:00:00.000Z'),
      currency: CurrencyCode.TZS,
      status: RecordBookStatus.FINALIZED,
      amount: 250,
      company: { id: 'company-1', name: 'Company', code: 'COMP' },
      division: null,
      branch: { id: 'branch-1', name: 'Main', code: 'MAIN' },
      expenseCategory: { id: 'cat-1', name: 'Food' },
    };
    const { service } = makeReportsService([sale('sale-1', CurrencyCode.TZS, 1000, 0)], [expense]);

    const result = await service.run('net-movement', {}, user);

    expect(result.rows).toEqual([
      expect.objectContaining({
        period: '2026-07-09',
        sales: 1000,
        expenses: 250,
        netMovement: 750,
      }),
    ]);
  });

  it('exports dense reports with the readable Records Book PDF layout', async () => {
    const { service, generatedDocuments } = makeReportsService([
      sale('sale-1', CurrencyCode.TZS, 1000, 500),
    ]);
    const response = {
      setHeader: jest.fn(),
      send: jest.fn((value) => value),
      json: jest.fn((value) => value),
    } as any;

    await service.export(
      'daily-sales',
      {
        companyId: 'company-1',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
        format: 'pdf',
      },
      user,
      response,
    );

    expect(generatedDocuments.generateTablePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        orientation: 'landscape',
        status: 'FINALIZED',
        stripedRows: true,
        sectionTitle: 'Report Detail',
        columnWeights: expect.arrayContaining([expect.any(Number)]),
        summary: expect.arrayContaining([
          expect.objectContaining({ label: 'Recorded Sales (TZS)' }),
        ]),
      }),
      user,
    );
  });
});
