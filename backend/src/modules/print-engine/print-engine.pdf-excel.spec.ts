import { PrintEngineService } from './print-engine.service';

/**
 * Phase 4 — verify PDF and Excel generation produce real binary artifacts
 * (correct magic bytes) and persist GeneratedDocument records.
 *
 * Lightweight Prisma mock — exceljs / pdfkit are loaded for real so the test
 * also catches packaging regressions (wrong version, missing transitive dep).
 */

function makeService() {
  const generatedRecords: any[] = [];
  const prisma: any = {
    documentTemplate: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'tmpl-1',
        name: 'Test Statement',
        companyId: 'co-1',
        content: '<p>Hello {{ name }}</p>',
        status: 'ACTIVE',
      }),
    },
    generatedDocument: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const rec = { id: `gen-${generatedRecords.length + 1}`, ...data };
        generatedRecords.push(rec);
        return rec;
      }),
    },
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const svc = new PrintEngineService(prisma, audit);
  return { svc, prisma, audit, generatedRecords };
}

describe('PrintEngineService — Phase 4 PDF / Excel materialization', () => {
  it('renderPdf produces a real PDF buffer (PDF magic bytes %PDF-)', async () => {
    const { svc, generatedRecords } = makeService();
    const result = await svc.renderPdf(
      { templateId: 'tmpl-1', data: { name: 'Receivables aging' } },
      { id: 'user-1' },
    );

    expect(result.mimeType).toBe('application/pdf');
    expect(result.filename).toMatch(/\.pdf$/);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.length).toBeGreaterThan(200); // any real PDF is > 200 bytes
    // PDFs begin with "%PDF-".
    expect(result.buffer.slice(0, 5).toString('utf-8')).toBe('%PDF-');
    expect(generatedRecords).toHaveLength(1);
    expect(generatedRecords[0].generatedDocumentNumber).toMatch(/^PDF-/);
  });

  it('renderExcel produces a real .xlsx buffer (ZIP magic bytes PK)', async () => {
    const { svc, generatedRecords } = makeService();
    const result = await svc.renderExcel(
      {
        templateId: 'tmpl-1',
        sheetName: 'AR Aging',
        sheetData: [
          { customer: 'Acme', total: 1200, days_30: 0, days_60: 1200 },
          { customer: 'Beta', total: 750, days_30: 750, days_60: 0 },
        ],
      },
      { id: 'user-1' },
    );

    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(result.filename).toMatch(/\.xlsx$/);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.length).toBeGreaterThan(500);
    // .xlsx is a ZIP container — magic bytes are "PK\x03\x04".
    expect(result.buffer[0]).toBe(0x50);
    expect(result.buffer[1]).toBe(0x4b);
    expect(generatedRecords[0].generatedDocumentNumber).toMatch(/^XLS-/);
  });

  it('renderExcel handles empty sheetData without throwing', async () => {
    const { svc } = makeService();
    const result = await svc.renderExcel(
      { templateId: 'tmpl-1', sheetData: [] },
      { id: 'user-1' },
    );
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('renderPdf rejects when template is missing', async () => {
    const { svc, prisma } = makeService();
    prisma.documentTemplate.findFirst.mockResolvedValueOnce(null);
    await expect(
      svc.renderPdf({ templateId: 'missing' }, { id: 'user-1' }),
    ).rejects.toThrow();
  });
});
