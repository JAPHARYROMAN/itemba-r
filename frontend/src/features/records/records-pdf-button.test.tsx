import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordsPdfButton } from './records-pdf-button';
const download = vi.hoisted(() => vi.fn());
vi.mock('@/lib/export-download', () => ({ downloadBinaryGet: download }));
beforeEach(() => {
  download.mockReset();
  download.mockResolvedValue(undefined);
});
describe('Records PDF control', () => {
  it('sends active filters safely and downloads independently in each window', async () => {
    render(
      <>
        <RecordsPdfButton
          path="/records/export/pdf"
          query={{ kind: 'DEBTOR', search: 'A & B', companyId: 'c', page: 3 }}
          label="Debtors PDF"
        />
        <RecordsPdfButton
          path="/records/export/pdf"
          query={{ kind: 'CREDITOR' }}
          label="Creditors PDF"
        />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Debtors PDF' }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        '/records/export/pdf?kind=DEBTOR&search=A+%26+B&companyId=c&page=3',
        'records.pdf',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Creditors PDF' }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith('/records/export/pdf?kind=CREDITOR', 'records.pdf'),
    );
  });
  it('shows server failure and permits a retry', async () => {
    download.mockRejectedValueOnce(new Error('Narrow the filters to export up to 5,000 records.'));
    render(<RecordsPdfButton path="/record-book/export/pdf" query={{ type: 'trash' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('5,000');
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(await screen.findByRole('status')).toHaveTextContent('PDF download started');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('does not export when dates are invalid or a download is pending', async () => {
    const view = render(<RecordsPdfButton path="/records/export/pdf" disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
    view.rerender(<RecordsPdfButton path="/records/export/pdf" />);
    let finish!: () => void;
    download.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toBeDisabled();
    fireEvent.click(screen.getByRole('button'));
    expect(download).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
  });
});
