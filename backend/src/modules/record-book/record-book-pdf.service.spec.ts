import 'reflect-metadata';
import { RecordBookPdfService } from './record-book-pdf.service';
import { RecordBookController } from './record-book.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { bookPdf } from './record-book.pdf';
const user = { id: 'reader' } as AuthUser;
function setup() {
  const records = {
    findDailySales: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    findExpenses: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    findCategories: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    findDailySale: jest.fn(),
    findExpense: jest.fn(),
  };
  const documents = { renderLetterheadPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')) };
  const reports = { auditExport: jest.fn().mockResolvedValue(undefined) };
  return {
    records,
    documents,
    reports,
    service: new RecordBookPdfService(records as never, documents as never, reports as never),
  };
}
describe('Daily Records PDFs', () => {
  it('requires view and export rights', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, RecordBookController.prototype.exportPdf)).toEqual([
      'record_book.view',
      'record_book.export',
    ]);
  });
  it('exports the full filtered register, using authorised list services and preserving scope', async () => {
    const { records, reports, service } = setup();
    await service.export(
      {
        type: 'sales',
        page: 3,
        limit: 20,
        companyId: 'c',
        divisionId: 'd',
        branchId: 'b',
        search: 'receipt',
        dateFrom: '2026-09-01',
        currency: 'TZS',
      },
      user,
    );
    expect(records.findDailySales).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 5001,
        companyId: 'c',
        divisionId: 'd',
        branchId: 'b',
        search: 'receipt',
        dateFrom: '2026-09-01',
        currency: 'TZS',
      }),
      user,
    );
    expect(reports.auditExport).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'pdf', companyId: 'c' }),
      user,
    );
  });
  it('exports categories instead of unrelated money movements', async () => {
    const { records, service } = setup();
    await service.export({ type: 'categories', companyId: 'c', search: 'Fuel' }, user);
    expect(records.findCategories).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'c', search: 'Fuel' }),
      user,
    );
    expect(records.findDailySales).not.toHaveBeenCalled();
    expect(records.findExpenses).not.toHaveBeenCalled();
  });
  it('exports all three trash sections with deleted-only scope', async () => {
    const { records, service } = setup();
    await service.export({ type: 'trash', companyId: 'c' }, user);
    for (const method of [records.findDailySales, records.findExpenses, records.findCategories])
      expect(method).toHaveBeenCalledWith(
        expect.objectContaining({ recordState: 'DELETED' }),
        user,
      );
  });
  it('refuses truncation and access failures before rendering', async () => {
    const { records, documents, service } = setup();
    records.findExpenses.mockResolvedValue({ data: [], total: 5001 });
    await expect(service.export({ type: 'expenses' }, user)).rejects.toThrow('5,000');
    records.findExpenses.mockRejectedValue(new Error('Access denied'));
    await expect(service.export({ type: 'expenses' }, user)).rejects.toThrow('Access denied');
    expect(documents.renderLetterheadPdf).not.toHaveBeenCalled();
  });
  it('uses the authorised record organisation for detail letterheads', async () => {
    const { records, documents, service } = setup();
    records.findExpense.mockResolvedValue({
      id: 'e',
      companyId: 'actual-company',
      branchId: 'actual-branch',
      currency: 'TZS',
      amount: 10,
    });
    await service.export({ type: 'expenses', recordId: 'e', companyId: 'untrusted-filter' }, user);
    expect(documents.renderLetterheadPdf).toHaveBeenCalledWith(
      { companyId: 'actual-company', branchId: 'actual-branch' },
      expect.any(Object),
      user,
    );
  });
  it('keeps no-receipt sales, currencies and full receipt details without merging days', () => {
    const pdf = bookPdf(
      'Daily sales',
      [
        {
          kind: 'sales',
          title: 'Sales',
          rows: [
            { id: 'one', currency: 'TZS', totalSalesAmount: 0.1, receipts: [] },
            {
              id: 'two',
              currency: 'TZS',
              totalSalesAmount: 0.2,
              receipts: [{ receiptType: 'CASH', amount: 0.2, reference: 'receipt-2' }],
            },
            { id: 'three', currency: 'USD', totalSalesAmount: 0.5 },
          ],
        },
      ],
      [],
    );
    expect(pdf.sections[0].table?.rows).toHaveLength(3);
    expect(pdf.sections[0].totals).toEqual([
      { label: 'Recorded sales (TZS)', value: '0.30' },
      { label: 'Recorded sales (USD)', value: '0.50' },
    ]);
    expect(JSON.stringify(pdf)).toContain('receipt-2');
  });
});
