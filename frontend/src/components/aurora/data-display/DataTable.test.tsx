import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataTable, type Column } from './DataTable';
import { downloadTablePdf } from '@/lib/export-download';

vi.mock('@/lib/export-download', () => ({
  downloadTablePdf: vi.fn().mockResolvedValue(undefined),
}));

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  amount: number;
}

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name' },
  { key: 'amount', header: 'Amount', align: 'right' },
  { key: 'actions', header: 'Actions', exportExclude: true },
];

const data: Row[] = [
  { id: '1', name: 'Widget', amount: 5 },
  { id: '2', name: 'Gadget', amount: 12 },
];

describe('DataTable export toolbar', () => {
  afterEach(() => {
    vi.mocked(downloadTablePdf).mockClear();
  });

  it('renders the single Export button when only exportable is set', () => {
    render(<DataTable columns={columns} data={data} exportable />);

    const csvButton = screen.getByRole('button', { name: 'Export to CSV' });
    expect(csvButton).toHaveTextContent('Export');
    expect(screen.queryByRole('button', { name: 'Export to PDF' })).toBeNull();
  });

  it('renders compact CSV and PDF buttons when exportPdf is set', () => {
    render(<DataTable columns={columns} data={data} exportable exportPdf />);

    expect(screen.getByRole('button', { name: 'Export to CSV' })).toHaveTextContent('CSV');
    expect(screen.getByRole('button', { name: 'Export to PDF' })).toHaveTextContent('PDF');
  });

  it('sends the export matrix (exportExclude removed, right-aligned as numeric) to downloadTablePdf', async () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        exportable
        exportPdf={{ title: 'Product list', companyId: 'c1' }}
        exportFileName="products"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export to PDF' }));

    await waitFor(() =>
      expect(downloadTablePdf).toHaveBeenCalledWith({
        title: 'Product list',
        subtitle: undefined,
        companyId: 'c1',
        columns: ['Name', 'Amount'],
        rows: [
          ['Widget', '5'],
          ['Gadget', '12'],
        ],
        numericColumns: [1],
        baseName: 'products',
      }),
    );
  });

  it('prefers a custom onExportPdf handler over the built-in one', async () => {
    const onExportPdf = vi.fn();
    render(
      <DataTable columns={columns} data={data} exportPdf onExportPdf={onExportPdf} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export to PDF' }));

    await waitFor(() => expect(onExportPdf).toHaveBeenCalledWith(data));
    expect(downloadTablePdf).not.toHaveBeenCalled();
  });
});
