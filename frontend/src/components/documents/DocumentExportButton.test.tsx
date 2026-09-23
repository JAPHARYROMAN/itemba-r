import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentExportButton } from './DocumentExportButton';
import { downloadBinaryExport } from '@/lib/export-download';

vi.mock('@/lib/export-download', () => ({
  downloadBinaryExport: vi.fn().mockResolvedValue(undefined),
}));
describe('Document export', () => {
  beforeEach(() => vi.clearAllMocks());
  it('exports the selected format through the authorised source endpoint', async () => {
    render(<DocumentExportButton source={{ entityType: 'PAYSLIP', entityId: 'pay-1' }} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'xlsx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export document' }));
    await waitFor(() =>
      expect(downloadBinaryExport).toHaveBeenCalledWith(
        '/generated-documents/export',
        { entityType: 'PAYSLIP', entityId: 'pay-1', format: 'xlsx' },
        'document.xlsx',
      ),
    );
  });
  it('does not silently truncate an oversized report', async () => {
    render(
      <DocumentExportButton
        table={{
          title: 'Report',
          columns: ['Amount'],
          rows: Array.from({ length: 5001 }, () => ['1']),
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export document' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('5,000');
    expect(downloadBinaryExport).not.toHaveBeenCalled();
  });
});
