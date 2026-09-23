import { zipSync, strToU8 } from 'fflate';
import { Document, Paragraph, Packer } from 'docx';
import * as ExcelJS from 'exceljs';
import { previewDocument, validateOfficeArchive } from './document-preview';

describe('Local document previews', () => {
  it('extracts Word as inert text', async () => {
    const buffer = await Packer.toBuffer(
      new Document({
        sections: [{ children: [new Paragraph('<script>test</script> & Company')] }],
      }),
    );
    const result = await previewDocument(
      buffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result.kind).toBe('text');
    expect('text' in result && result.text).toContain('<script>test</script>');
  });
  it('reads quoted CSV fields and newlines', async () => {
    const result = await previewDocument(
      Buffer.from('Name,Note\r\n"Alpha, Ltd","two\nlines"'),
      'text/csv',
    );
    expect(result.kind).toBe('table');
    expect('sheets' in result && result.sheets[0].rows[1]).toEqual(['Alpha, Ltd', 'two\nlines']);
  });
  it('shows spreadsheet cached values, limits rows, and excludes hidden sheets', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Visible');
    sheet.addRow([{ formula: '1+2', result: 3 }, { formula: 'UNKNOWN()' }]);
    for (let i = 0; i < 220; i++) sheet.addRow([i]);
    book.addWorksheet('Hidden', { state: 'veryHidden' }).addRow(['hidden data']);
    const result = await previewDocument(
      Buffer.from(await book.xlsx.writeBuffer()),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(result.kind).toBe('table');
    if (result.kind !== 'table') throw new Error('Expected a table');
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].rows).toHaveLength(200);
    expect(result.sheets[0].rows[0]).toEqual(['3', '[Formula: no saved result]']);
    expect(result.truncated).toBe(true);
  });
  it('rejects oversized expanded archives before parsing Office content', () => {
    const zip = zipSync({ 'word/document.xml': new Uint8Array(17 * 1024 * 1024) });
    expect(() => validateOfficeArchive(Buffer.from(zip), 'word/document.xml')).toThrow(/too large/);
  });
  it('shows merged cells once and preserves exported decimal places', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Sheet');
    sheet.addRow(['Company']);
    sheet.mergeCells('A1:B1');
    sheet.getCell('A2').value = 1250.5;
    sheet.getCell('A2').numFmt = '0.00';
    const preview = await previewDocument(
      Buffer.from(await book.xlsx.writeBuffer()),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    if (preview.kind !== 'table') throw new Error('Expected a table');
    expect(preview.sheets[0].rows[0]).toEqual(['Company', '']);
    expect(preview.sheets[0].rows[1][0]).toBe('1250.50');
  });
  it('rejects archives with the wrong format and damaged files', async () => {
    expect(() =>
      validateOfficeArchive(
        Buffer.from(zipSync({ 'foo.txt': strToU8('hello') })),
        'word/document.xml',
      ),
    ).toThrow(/does not match/);
    await expect(
      previewDocument(
        Buffer.from('not a zip'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).rejects.toThrow(/could not be previewed/);
  });
  it('does not inline active content or spoofed PDFs', async () => {
    expect(
      (await previewDocument(Buffer.from('<svg onload="run()"/>'), 'image/svg+xml')).kind,
    ).toBe('download');
    expect((await previewDocument(Buffer.from('<html>oops</html>'), 'application/pdf')).kind).toBe(
      'download',
    );
  });
});
