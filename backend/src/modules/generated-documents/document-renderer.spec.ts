import { unzipSync, strFromU8 } from 'fflate';
import * as ExcelJS from 'exceljs';
import * as mammoth from 'mammoth';
import { renderDocument, csvCell } from './document-renderer';
import { BusinessPdfModel } from './pdf-builder';

const model: BusinessPdfModel = {
  title: 'Supplier statement',
  reference: 'SUP-1001',
  generatedAt: new Date('2026-09-19T10:00:00Z'),
  organization: {
    name: 'Example Trading Ltd',
    groupName: 'ITEMBA GROUP',
    tin: 'COMPANY-TAX-1',
    address: 'Example company address',
  },
  meta: [{ label: 'Period', value: 'September 2026' }],
  sections: [
    {
      title: 'Purchases',
      table: {
        headers: ['Invoice', 'Amount'],
        rows: [
          ['=DANGEROUS()', '1250.50'],
          ['Long identifier 01234567890123456789', '999999999999999999.99'],
        ],
        numericColumns: [1],
      },
      totals: [{ label: 'Due', value: 'TZS 1250.50' }],
      signatures: ['Finance officer'],
    },
  ],
};

describe('Shared document formats', () => {
  it('creates a real PDF with company identity', async () => {
    const result = await renderDocument(model, 'pdf');
    expect(result.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.toString()).toContain('EXAMPLE TRADING LTD');
  });
  it('creates editable Word content with repeating company letterhead and page footer', async () => {
    const result = await renderDocument(model, 'docx');
    const files = unzipSync(result);
    expect(strFromU8(files['word/header1.xml'])).toContain('COMPANY-TAX-1');
    expect(strFromU8(files['word/footer1.xml'])).toContain('PAGE');
    const text = (await mammoth.extractRawText({ buffer: result })).value;
    expect(text).toContain('SUP-1001');
    expect(text).toContain('1250.50');
    expect(text).toContain('Finance officer');
  });
  it('preserves numeric columns without executing formulas or rounding long values in Excel', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await renderDocument(model, 'xlsx')) as unknown as ExcelJS.Buffer);
    let found = false;
    book.worksheets[0].eachRow((row) => {
      if (row.getCell(1).value === '=DANGEROUS()') {
        found = true;
        expect(row.getCell(1).type).toBe(ExcelJS.ValueType.String);
        expect(row.getCell(2).value).toBe(1250.5);
      }
      if (String(row.getCell(1).value).startsWith('Long identifier'))
        expect(row.getCell(2).value).toBe('999999999999999999.99');
    });
    expect(found).toBe(true);
  });
  it('preserves text and protects CSV cells including whitespace-prefixed formulas', async () => {
    expect(csvCell(' \t=HYPERLINK("unsafe")')).toBe('"\' \t=HYPERLINK(""unsafe"")"');
    const csv = (await renderDocument(model, 'csv')).toString();
    expect(csv).toContain("'=DANGEROUS()");
    expect(csv).toContain('Example Trading Ltd');
    expect((await renderDocument(model, 'txt')).toString()).toContain('Due\tTZS 1250.50');
  });
});
