import 'reflect-metadata';
import { Prisma, RecordEntry } from '@prisma/client';
import { recordsPdf, recordDetailPdf } from './records.pdf';
import { RecordsService } from './records.service';
import { RecordsController } from './records.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { recordsPdfRows } from './records-pdf-rows';

function row(kind = 'DEBTOR', currency = 'TZS', amount = '100.30') {
  return {
    id: 'test-id',
    kind,
    currency,
    amount: new Prisma.Decimal(amount),
    settledAmount: new Prisma.Decimal('30.10'),
    recordDate: new Date('2026-09-01'),
    dueDate: null,
    voidedAt: null,
    title: 'Test entry',
    counterparty: 'Test party',
    notes: null,
    companyId: null,
  } as RecordEntry;
}
describe('Records PDFs', () => {
  it('continues long prose on word boundaries without losing content', () => {
    const note = 'A useful line of text retained in full. '.repeat(20);
    const rows = recordsPdfRows([[note]]).flat();
    expect(rows.join('')).toBe(note);
    expect(rows.slice(0, -1).every((row) => /\s$/.test(row))).toBe(true);
  });
  it('keeps creditors, debtors and currencies separate with exact outstanding amounts', () => {
    const model = recordsPdf([row(), row('DEBTOR', 'USD'), row('CREDITOR')], {
      page: 4,
      from: '2026-09-01',
    });
    expect(model.sections.slice(0, 3).map((s) => s.title)).toEqual([
      'Debtors - TZS',
      'Debtors - USD',
      'Creditors - TZS',
    ]);
    for (const section of model.sections.slice(0, 3))
      expect(section.totals?.at(-1)?.value).toBe('70.20');
    expect(model.meta[0].value).toContain('2026-09-01');
  });
  it('preserves every character in long notes and exports notes without monetary totals', () => {
    const note = {
      ...row('NOTE', 'TZS', '0'),
      notes: 'Useful detail\n'.repeat(800) + 'FINAL NOTE MARKER',
    };
    const model = recordsPdf([note], { page: 1 });
    expect(model.sections[0].table?.rows.map((r) => r[2]).join('')).toBe(note.notes);
    expect(model.sections[0].totals).toBeUndefined();
    expect(recordDetailPdf(note).sections[1].table?.rows.flat().join('')).toBe(note.notes);
    expect(model.sections[0].table?.rows.every((r) => r.every((c) => c.length <= 180))).toBe(true);
  });
  it('exports empty filters as an explicit empty document', () => {
    expect(recordsPdf([], { page: 1 }).sections[0].paragraphs).toContain(
      'No records match these filters.',
    );
  });
  it('requires both view and export permissions on both PDF endpoints', () => {
    for (const method of ['exportPdf', 'exportDetailPdf'] as const)
      expect(Reflect.getMetadata(PERMISSIONS_KEY, RecordsController.prototype[method])).toEqual([
        'records.view',
        'records.export',
      ]);
  });
  it('uses owner/company/branch scope and all matching rows rather than the UI page', async () => {
    const db = {
      recordEntry: {
        findMany: jest.fn().mockResolvedValue([row()]),
        fields: { amount: 'amount-field' },
      },
    };
    const companies = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: { in: ['allowed'] } }),
      assertCanAccessCompany: jest.fn(),
    };
    const org = { recordWhereFor: jest.fn().mockResolvedValue({ branchId: 'allowed-branch' }) };
    const documents = { renderLetterheadPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')) };
    const service = new RecordsService(
      db as never,
      companies as never,
      org as never,
      {} as never,
      documents as never,
    );
    await service.exportPdf({ id: 'owner' } as AuthUser, {
      page: 8,
      kind: 'DEBTOR',
      from: '2026-09-01',
      search: 'Test',
    });
    const args = db.recordEntry.findMany.mock.calls[0][0];
    expect(args.skip).toBeUndefined();
    expect(JSON.stringify(args.where)).toContain('allowed-branch');
    expect(JSON.stringify(args.where)).toContain('owner');
    expect(JSON.stringify(args.where)).toContain('DEBTOR');
    expect(args.take).toBe(10001);
    db.recordEntry.findMany.mockResolvedValue(Array(10001).fill(row()));
    await expect(service.exportPdf({ id: 'owner' } as AuthUser, { page: 1 })).rejects.toThrow(
      '10,000',
    );
    expect(documents.renderLetterheadPdf).toHaveBeenCalledTimes(1);
    companies.assertCanAccessCompany.mockRejectedValue(new Error('No access'));
    await expect(
      service.exportPdf({ id: 'owner' } as AuthUser, { page: 1, companyId: 'denied' }),
    ).rejects.toThrow('No access');
  });
});
