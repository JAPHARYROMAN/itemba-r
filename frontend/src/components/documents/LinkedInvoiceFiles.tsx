'use client';
import { useState } from 'react';
import { Btn, FormInput } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { FilePreviewDialog } from './FilePreviewDialog';
import type { FilePreviewSource } from './file-preview-source';
type File = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  invoiceId: string;
  invoice: { invoiceNumber: string; company: { name: string } };
};
export function LinkedInvoiceFiles() {
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const allowed = hasPermission('documents.view') && hasPermission('invoice_desk.view');
  const result = useWorkspaceResource<{ rows: File[]; total: number }>(
    '/invoice-desk/attachments',
    { search, page },
    allowed,
  );
  const files: FilePreviewSource[] = (result.data?.rows ?? []).map((f) => ({
    kind: 'invoice-attachment',
    id: f.id,
    invoiceId: f.invoiceId,
    title: f.name,
    fileName: f.name,
  }));
  if (!allowed) return <p>Invoice Desk access is required to open linked invoice files.</p>;
  return (
    <section className="space-y-4">
      <h2>Linked invoice files</h2>
      <p>Original attachments, opened with the invoice’s company and organisation permissions.</p>
      <FormInput
        label="Find an invoice attachment"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      {result.error ? (
        <p role="alert">
          {result.error} <Btn onClick={result.reload}>Retry</Btn>
        </p>
      ) : result.loading ? (
        <p role="status">Loading linked files…</p>
      ) : (
        <>
          <ul className="space-y-3">
            {result.data?.rows.map((f, i) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                key={f.id}
              >
                <div>
                  <strong>{f.name}</strong>
                  <p>
                    {f.invoice.company.name} · {f.invoice.invoiceNumber}
                  </p>
                  <Link
                    href={`/invoice-desk?source=direct&record=${encodeURIComponent(f.invoiceId)}`}
                  >
                    Open source invoice
                  </Link>
                </div>
                <Btn onClick={() => setPreview(files[i])}>Preview & download</Btn>
              </li>
            ))}
          </ul>
          {!result.data?.rows.length && <p>No attachments match this search.</p>}
          <nav className="flex gap-3" aria-label="Linked file pages">
            <Btn disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Btn>
            <span>Page {page}</span>
            <Btn
              disabled={page * 25 >= (result.data?.total ?? 0)}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Btn>
          </nav>
        </>
      )}
      {preview && (
        <FilePreviewDialog sources={files} initial={preview} onClose={() => setPreview(null)} />
      )}
    </section>
  );
}
