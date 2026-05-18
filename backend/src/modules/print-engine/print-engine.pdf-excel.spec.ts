import { PrintEngineService } from './print-engine.service';

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
        const record = { id: `gen-${generatedRecords.length + 1}`, ...data };
        generatedRecords.push(record);
        return record;
      }),
    },
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new PrintEngineService(prisma, audit), prisma, generatedRecords };
}

describe('PrintEngineService PDF and Excel materialization', () => {
  it('renderPdf produces a PDF buffer and persists metadata', async () => {
    const { service, generatedRecords } = makeService();

    const result = await service.renderPdf(
      { templateId: 'tmpl-1', data: { name: 'Receivables aging' } },
      { id: 'user-1' },
    );

    expect(result.mimeType).toBe('application/pdf');
    expect(result.filename).toMatch(/\.pdf$/);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.slice(0, 5).toString('utf8')).toBe('%PDF-');
    expect(generatedRecords[0].outputFormat).toBe('PDF');
    expect(generatedRecords[0].generatedDocumentNumber).toMatch(/^PDF-/);
  });

  it('renderExcel produces an xlsx buffer and persists metadata', async () => {
    const { service, generatedRecords } = makeService();

    const result = await service.renderExcel(
      {
        templateId: 'tmpl-1',
        sheetName: 'AR Aging',
        sheetData: [
          { customer: 'Acme', total: 1200 },
          { customer: 'Beta', total: 750 },
        ],
      },
      { id: 'user-1' },
    );

    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(result.filename).toMatch(/\.xlsx$/);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer[0]).toBe(0x50);
    expect(result.buffer[1]).toBe(0x4b);
    expect(generatedRecords[0].outputFormat).toBe('EXCEL');
    expect(generatedRecords[0].generatedDocumentNumber).toMatch(/^XLS-/);
  });

  it('renderExcel handles empty sheetData', async () => {
    const { service } = makeService();
    const result = await service.renderExcel({ templateId: 'tmpl-1', sheetData: [] }, { id: 'user-1' });

    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('renderPdf rejects when the template is missing', async () => {
    const { service, prisma } = makeService();
    prisma.documentTemplate.findFirst.mockResolvedValueOnce(null);

    await expect(service.renderPdf({ templateId: 'missing' }, { id: 'user-1' })).rejects.toThrow();
  });
});
