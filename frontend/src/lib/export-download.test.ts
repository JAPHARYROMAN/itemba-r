import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadReportPdf,
  downloadTablePdf,
  filenameFromDisposition,
  TABLE_PDF_MAX_ROWS,
  type TablePdfRequest,
} from './export-download';
import { reportToTable } from './report-export';

function pdfResponse(disposition?: string) {
  return new Response('%PDF-1.7 fake-bytes', {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      ...(disposition ? { 'Content-Disposition': disposition } : {}),
    },
  });
}

const createObjectURL = vi.fn(() => 'blob:mock-url');
const revokeObjectURL = vi.fn();

describe('export-download', () => {
  /** Download filenames captured from anchor clicks. */
  let downloads: string[];

  beforeEach(() => {
    downloads = [];
    // jsdom has no createObjectURL and anchor clicks would attempt navigation.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
  });

  afterEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.restoreAllMocks();
  });

  describe('filenameFromDisposition', () => {
    it('extracts a quoted filename', () => {
      expect(
        filenameFromDisposition('attachment; filename="products-2026-07-05.pdf"', 'fallback.pdf'),
      ).toBe('products-2026-07-05.pdf');
    });

    it('extracts an unquoted filename', () => {
      expect(filenameFromDisposition('attachment; filename=report.pdf', 'fallback.pdf')).toBe(
        'report.pdf',
      );
    });

    it('falls back when the header is missing', () => {
      expect(filenameFromDisposition(null, 'fallback.pdf')).toBe('fallback.pdf');
    });

    it('falls back when the header has no filename', () => {
      expect(filenameFromDisposition('attachment', 'fallback.pdf')).toBe('fallback.pdf');
    });
  });

  describe('downloadTablePdf', () => {
    const request: TablePdfRequest = {
      title: 'Products',
      columns: ['Name', 'Qty'],
      rows: [['Widget', '2']],
      numericColumns: [1],
      baseName: 'products',
    };

    it('posts the request to the table-pdf endpoint and uses the disposition filename', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(pdfResponse('attachment; filename="products-2026-07-05.pdf"'));

      await downloadTablePdf(request);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/backend/generated-documents/table-pdf',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }),
      );
      expect(downloads).toEqual(['products-2026-07-05.pdf']);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('falls back to a baseName + date-stamp filename without a disposition header', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(pdfResponse());
      const stamp = new Date().toISOString().slice(0, 10);

      await downloadTablePdf(request);

      expect(downloads).toEqual([`products-${stamp}.pdf`]);
    });

    it('throws the server error message on a non-2xx JSON response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'Company not accessible' }), { status: 403 }),
      );

      await expect(downloadTablePdf(request)).rejects.toThrow('Company not accessible');
      expect(downloads).toEqual([]);
    });

    it('joins array validation messages on a non-2xx response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: ['title is required', 'rows too long'] }), {
          status: 400,
        }),
      );

      await expect(downloadTablePdf(request)).rejects.toThrow(
        'title is required, rows too long',
      );
    });

    it('uses a status-based message when the error body is not JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502 }));

      await expect(downloadTablePdf(request)).rejects.toThrow('Export failed (502)');
    });

    /** Parse the JSON body from the first mocked fetch call. */
    function sentBody(fetchMock: ReturnType<typeof vi.spyOn>): TablePdfRequest {
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      return JSON.parse(init.body as string) as TablePdfRequest;
    }

    it('truncates rows beyond the cap and appends a note meta entry', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pdfResponse());
      const rows = Array.from({ length: TABLE_PDF_MAX_ROWS + 2 }, (_, i) => [`Item ${i}`, '1']);

      await downloadTablePdf({ title: 'Big export', columns: ['Name', 'Qty'], rows });

      const body = sentBody(fetchMock);
      expect(body.rows).toHaveLength(TABLE_PDF_MAX_ROWS);
      expect(body.rows[TABLE_PDF_MAX_ROWS - 1]).toEqual([`Item ${TABLE_PDF_MAX_ROWS - 1}`, '1']);
      expect(body.meta).toEqual([
        {
          label: 'Note',
          value: `Showing first ${TABLE_PDF_MAX_ROWS} of ${rows.length} rows — use CSV for the full data`,
        },
      ]);
    });

    it('clamps title, subtitle, baseName and meta strings to the backend caps', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pdfResponse());

      await downloadTablePdf({
        title: 'T'.repeat(200),
        subtitle: 'S'.repeat(300),
        baseName: 'b'.repeat(100),
        columns: ['Name'],
        rows: [['Widget']],
        meta: [{ label: 'L'.repeat(80), value: 'V'.repeat(300) }],
      });

      const body = sentBody(fetchMock);
      expect(body.title).toHaveLength(120);
      expect(body.title.endsWith('…')).toBe(true);
      expect(body.subtitle).toHaveLength(160);
      expect(body.baseName).toHaveLength(80);
      expect(body.meta?.[0].label).toHaveLength(60);
      expect(body.meta?.[0].value).toHaveLength(200);
    });

    it('keeps meta at no more than 12 entries when the truncation note is added', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pdfResponse());
      const rows = Array.from({ length: TABLE_PDF_MAX_ROWS + 1 }, () => ['Widget', '1']);
      const meta = Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));

      await downloadTablePdf({ title: 'Big export', columns: ['Name', 'Qty'], rows, meta });

      const body = sentBody(fetchMock);
      expect(body.meta).toHaveLength(12);
      expect(body.meta?.[10]).toEqual({ label: 'L10', value: 'V10' });
      expect(body.meta?.[11].label).toBe('Note');
    });
  });

  describe('downloadReportPdf', () => {
    it('posts the detected primary table and returns true', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(pdfResponse('attachment; filename="finance-tax-2026-07-05.pdf"'));

      const ok = await downloadReportPdf(
        { items: [{ name: 'VAT', amount: 100 }] },
        'finance-tax',
        { title: 'Tax report', companyId: 'c1' },
      );

      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/backend/generated-documents/table-pdf',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            title: 'Tax report',
            companyId: 'c1',
            columns: ['name', 'amount'],
            rows: [['VAT', '100']],
            baseName: 'finance-tax',
          }),
        }),
      );
      expect(downloads).toEqual(['finance-tax-2026-07-05.pdf']);
    });

    it('returns false without fetching when there is nothing tabular', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      await expect(downloadReportPdf({ total: 5 }, 'empty-report')).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('reportToTable', () => {
    it('converts an array of flat objects into a column/row matrix', () => {
      expect(reportToTable([{ name: 'A', qty: 1 }, { name: 'B', qty: 2 }])).toEqual({
        columns: ['name', 'qty'],
        rows: [
          ['A', '1'],
          ['B', '2'],
        ],
      });
    });

    it('picks the largest tabular field and flattens one nesting level', () => {
      expect(
        reportToTable({
          summary: { total: 3 },
          lines: [{ ref: 'X', customer: { name: 'Acme' } }],
        }),
      ).toEqual({
        columns: ['ref', 'customer.name'],
        rows: [['X', 'Acme']],
      });
    });

    it('returns null when there is no tabular data', () => {
      expect(reportToTable({ total: 5 })).toBeNull();
      expect(reportToTable(null)).toBeNull();
      expect(reportToTable([])).toBeNull();
    });
  });
});
