import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewPane } from './FilePreview';
import { FilePreviewDialog } from './FilePreviewDialog';
import { DocumentArtifactButton } from './DocumentArtifactButton';
import { Modal } from '@/components/ui/modal';
import type { FilePreviewSource } from './file-preview-source';
import DocumentsPage from '@/app/(dashboard)/group-control/documents/page';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  binary: vi.fn(),
  post: vi.fn(),
  user: { id: 'user-a', companyId: 'a', permissions: ['documents.view', 'invoice_desk.view'] },
  objectUrl: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: api.get,
  backendBinaryGet: api.binary,
  backendPost: api.post,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: api.user,
    hasPermission: (p: string) => api.user.permissions.includes(p),
  }),
}));
const source: FilePreviewSource = {
  kind: 'document',
  id: 'one',
  title: 'Company letter',
  fileName: 'letter.docx',
};
beforeEach(() => {
  vi.clearAllMocks();
  api.user = { id: 'user-a', companyId: 'a', permissions: ['documents.view', 'invoice_desk.view'] };
  api.get.mockResolvedValue({ kind: 'text', text: 'First file content' });
  api.binary.mockResolvedValue({
    blob: new Blob(['file'], { type: 'application/pdf' }),
    disposition: 'attachment; filename="invoice.pdf"',
  });
  api.objectUrl.mockReturnValue('blob:preview');
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = api.objectUrl;
      static revokeObjectURL = api.revoke;
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Quick Look file experience', () => {
  it('opens library files without leaving the register', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: string) =>
          new Response(
            JSON.stringify({
              data:
                input.includes('letterhead-companies') || input.includes('expiring')
                  ? []
                  : input.includes('/summary')
                    ? { total: 1, confidential: 0, expired: 0, expiringSoon: 0 }
                    : {
                        data: [
                          {
                            id: 'library-file',
                            title: 'Branch agreement',
                            fileName: 'Agreement.docx',
                            category: 'CONTRACT',
                            status: 'ACTIVE',
                            createdAt: '2026-09-01',
                            version: 1,
                          },
                        ],
                        total: 1,
                        page: 1,
                        totalPages: 1,
                      },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
    render(<DocumentsPage />);
    const events = userEvent.setup();
    const trigger = await screen.findByRole('button', { name: 'Preview Branch agreement' });
    await events.click(trigger);
    await screen.findByText('First file content');
    expect(api.get).toHaveBeenCalledWith('/documents/library-file/preview', expect.anything());
    await events.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Branch agreement' })).toBeInTheDocument();
  });
  it('presents one worksheet at a time, preserves literal cell text and exposes preview limits', async () => {
    api.get.mockResolvedValue({
      kind: 'table',
      note: 'Saved formula values only.',
      truncated: true,
      sheets: [
        { name: 'Invoices', rows: [['<script>bad()</script>', '100']] },
        { name: 'Payments', rows: [['Paid', '25']] },
      ],
    });
    const view = render(<FilePreviewPane source={source} />);
    await screen.findByRole('combobox', { name: 'Worksheet' });
    expect(screen.getByText('<script>bad()</script>')).toBeInTheDocument();
    expect(view.container.querySelector('script')).toBeNull();
    expect(screen.getByText(/preview is shortened/)).toBeInTheDocument();
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Worksheet'), { target: { value: '1' } });
    expect(screen.getByRole('region', { name: 'Payments' })).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(await axe(view.container)).toHaveNoViolations();
    expect(api.binary).not.toHaveBeenCalled();
  });
  it('clears prior content immediately on a file change and ignores a late response', async () => {
    let finish!: (value: unknown) => void;
    api.get.mockImplementation((path) =>
      path.includes('/one/')
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ kind: 'text', text: 'Second file content' }),
    );
    const view = render(<FilePreviewPane source={source} />);
    const signal = api.get.mock.calls[0][1].signal as AbortSignal;
    view.rerender(<FilePreviewPane source={{ ...source, id: 'two' }} />);
    expect(signal.aborted).toBe(true);
    await screen.findByText('Second file content');
    await act(async () => finish({ kind: 'text', text: 'Obsolete file content' }));
    expect(screen.queryByText('Obsolete file content')).not.toBeInTheDocument();
  });
  it('loads PDF bytes through the authenticated source and releases object URLs on close', async () => {
    api.get.mockResolvedValue({ kind: 'pdf' });
    const view = render(
      <FilePreviewPane
        source={{ kind: 'generated-document', id: 'artifact/1', title: 'Payslip' }}
      />,
    );
    await screen.findByTitle('Payslip');
    expect(api.get).toHaveBeenCalledWith(
      '/generated-documents/artifact%2F1/preview',
      expect.anything(),
    );
    expect(api.binary).toHaveBeenCalledWith(
      '/generated-documents/artifact%2F1/download',
      expect.any(AbortSignal),
    );
    expect(screen.getByTitle('Payslip')).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByRole('link', { name: 'Open PDF in browser' })).toHaveAttribute(
      'href',
      '/api/backend/generated-documents/artifact%2F1/download?inline=1',
    );
    view.unmount();
    expect(api.revoke).toHaveBeenCalledWith('blob:preview');
  });
  it('shows an access failure after metadata without embedding an error response, then retries', async () => {
    api.get.mockResolvedValue({ kind: 'pdf' });
    api.binary.mockRejectedValueOnce(new Error('File access revoked'));
    render(<FilePreviewPane source={source} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('File access revoked');
    expect(api.objectUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTitle(source.title);
    expect(api.get).toHaveBeenCalledTimes(2);
  });
  it('refuses HTML masquerading as an inline PDF', async () => {
    api.get.mockResolvedValue({ kind: 'pdf' });
    api.binary.mockResolvedValue({
      blob: new Blob(['<script>unsafe()</script>'], { type: 'text/html' }),
    });
    render(<FilePreviewPane source={source} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('file format changed');
    expect(api.objectUrl).not.toHaveBeenCalled();
  });
  it('downloads the original after a preview failure with explicit retry and no double submission', async () => {
    api.get.mockRejectedValue(new Error('Encrypted file'));
    api.binary.mockRejectedValueOnce(new Error('Download unavailable'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<FilePreviewPane source={source} />);
    await screen.findByText('Encrypted file');
    fireEvent.click(screen.getByRole('button', { name: 'Download original' }));
    await screen.findByText('Download unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Download original' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download original' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(api.binary).toHaveBeenCalledTimes(2);
    expect(api.revoke).toHaveBeenCalledWith('blob:preview');
    expect(document.querySelector('a[download]')).toBeNull();
  });
  it('clears loaded content and requests when the account or permissions change', async () => {
    const view = render(<FilePreviewPane source={source} />);
    await screen.findByText('First file content');
    const signal = api.get.mock.calls[0][1].signal as AbortSignal;
    api.user = { id: 'user-b', companyId: 'b', permissions: [] };
    view.rerender(<FilePreviewPane source={source} />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('First file content')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('cannot open this file');
    expect(api.get).toHaveBeenCalledTimes(1);
  });
  it('switches files with keyboard controls and restores the nested invoice dialog trigger', async () => {
    function Harness() {
      const [preview, setPreview] = useState(false);
      const files: FilePreviewSource[] = [source, { ...source, id: 'two', title: 'Receipt' }];
      return (
        <Modal open title="Invoice" onClose={vi.fn()}>
          <button onClick={() => setPreview(true)}>Inspect attachment</button>
          {preview && (
            <FilePreviewDialog
              sources={files}
              initial={files[0]}
              onClose={() => setPreview(false)}
            />
          )}
        </Modal>
      );
    }
    render(<Harness />);
    const events = userEvent.setup();
    await events.click(screen.getByRole('button', { name: 'Inspect attachment' }));
    await screen.findByText('First file content');
    const next = screen.getByRole('button', { name: 'Next file' });
    next.focus();
    await events.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Receipt' });
    expect(api.get).toHaveBeenLastCalledWith('/documents/two/preview', expect.anything());
    await events.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Invoice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect attachment' })).toHaveFocus();
  });
  it('generates once and previews or reopens the same PDF without creating another artifact', async () => {
    api.post.mockResolvedValue({
      generatedDocument: { id: 'generated' },
      document: { id: 'file', fileName: 'Payslip.pdf' },
    });
    render(<DocumentArtifactButton entityType="PAYSLIP" entityId="entry" />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    fireEvent.click(screen.getByRole('button', { name: /Generat/ }));
    await screen.findByRole('dialog', { name: 'Payslip.pdf' });
    await screen.findByText('First file content');
    expect(api.get).toHaveBeenCalledWith(
      '/generated-documents/generated/preview',
      expect.anything(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview PDF' }));
    await screen.findByRole('dialog', { name: 'Payslip.pdf' });
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('aborts obsolete generation and never opens its result for another record', async () => {
    let finish!: (value: unknown) => void;
    api.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<DocumentArtifactButton entityType="PAYSLIP" entityId="one" />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    const signal = api.post.mock.calls[0][2].signal as AbortSignal;
    view.rerender(<DocumentArtifactButton entityType="PAYSLIP" entityId="two" />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ generatedDocument: { id: 'old' }, document: { id: 'old' } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
