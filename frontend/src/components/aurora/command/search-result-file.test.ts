import { describe, expect, it } from 'vitest';
import { searchResultFile } from './search-result-file';
import { filePreviewPaths } from '@/components/documents/file-preview-source';

const result = { id: 'scan / 1', title: 'Receipt' };
describe('File search source validation', () => {
  it('builds authenticated encoded paths from identifiers, never a supplied URL', () => {
    const source = searchResultFile(
      {
        ...result,
        file: {
          kind: 'invoice-attachment',
          id: result.id,
          invoiceId: 'invoice & branch',
          title: '',
          downloadUrl: 'https://outside.test/file',
        },
      },
      (p) => p === 'invoice_desk.view',
    );
    expect(source?.title).toBe('Receipt');
    expect(filePreviewPaths(source!).preview).toBe(
      '/invoice-desk/invoices/invoice%20%26%20branch/attachments/scan%20%2F%201/preview',
    );
  });
  it.each([
    null,
    'file.pdf',
    { kind: 'remote', id: result.id },
    { kind: 'document', id: 'different' },
    { kind: 'invoice-attachment', id: result.id },
    { kind: 'invoice-attachment', id: result.id, invoiceId: '' },
  ])('ignores unsupported or incomplete metadata %j', (file) => {
    expect(searchResultFile({ ...result, file }, () => true)).toBeUndefined();
  });
  it('requires source-specific permission and accepts positive document versions only', () => {
    const row = { ...result, file: { kind: 'document', id: result.id, version: 2 } };
    expect(searchResultFile(row, (p) => p === 'invoice_desk.view')).toBeUndefined();
    expect(searchResultFile(row, (p) => p === 'documents.view')).toMatchObject({
      kind: 'document',
      version: 2,
    });
    expect(
      searchResultFile({ ...row, file: { ...row.file, version: -1 } }, () => true)?.version,
    ).toBeUndefined();
  });
});
