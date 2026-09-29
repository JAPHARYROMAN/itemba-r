'use client';

import { useState } from 'react';
import { Btn, Card } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { notifyDeskSaved } from '@/components/workspace/linked-desk-changes';
import { backendPatch } from '@/lib/api-client';

interface UnlinkedSupplier {
  id: string;
  companyId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company: { name: string };
  _count: { invoices: number };
}

interface SupplierChoice {
  id: string;
  name: string;
  legalName?: string | null;
  supplierCode?: string | null;
  tin?: string | null;
  companyId: string;
}

export function InvoiceSupplierReconciliation() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('invoice_desk.view') && hasPermission('suppliers.view');
  const canLink =
    canView && hasPermission('invoice_desk.manage') && hasPermission('suppliers.update');
  const result = useWorkspaceResource<UnlinkedSupplier[]>(
    '/invoice-desk/suppliers/unlinked',
    {},
    canView,
  );
  const [message, setMessage] = useState('');

  if (!canView || (result.loading && !result.data) || result.error || !result.data?.length)
    return result.error ? (
      <Card className="mt-5 p-4">
        <p role="alert" className="workspace-notice">
          Could not load older Invoice Desk supplier records: {result.error}
        </p>
        <Btn variant="secondary" size="sm" onClick={result.reload}>
          Try again
        </Btn>
      </Card>
    ) : null;

  return (
    <Card className="mt-5 space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Older Invoice Desk supplier records
        </h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          These records need an explicit match. Their invoices and payments are preserved; link each
          one to the correct shared supplier to bring it into the shared profile.
        </p>
      </div>
      {message && (
        <p role="status" className="workspace-notice">
          {message}
        </p>
      )}
      <div className="space-y-3">
        {result.data.map((supplier) => (
          <UnlinkedSupplierRow
            key={supplier.id}
            supplier={supplier}
            canLink={canLink}
            onLinked={() => {
              setMessage(`${supplier.name} is now linked to the shared supplier profile.`);
              result.reload();
            }}
          />
        ))}
      </div>
    </Card>
  );
}

function UnlinkedSupplierRow({
  supplier,
  canLink,
  onLinked,
}: {
  supplier: UnlinkedSupplier;
  canLink: boolean;
  onLinked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(supplier.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const candidates = useWorkspaceResource<{
    data: SupplierChoice[];
  }>(
    '/suppliers',
    { companyId: supplier.companyId, search: search.trim(), page: 1, limit: 20 },
    open && canLink && search.trim().length > 0,
  );

  async function link(canonicalSupplierId: string) {
    if (busy || !canLink) return;
    setBusy(true);
    setError('');
    try {
      await backendPatch(`/invoice-desk/suppliers/${encodeURIComponent(supplier.id)}/link`, {
        canonicalSupplierId,
      });
      notifyDeskSaved('invoice-desk');
      onLinked();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not link this supplier.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium" style={{ color: 'var(--aurora-text)' }}>
            {supplier.name}
          </p>
          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            {supplier.company.name} · {supplier._count.invoices} Invoice Desk invoice
            {supplier._count.invoices === 1 ? '' : 's'}
            {supplier.email ? ` · ${supplier.email}` : ''}
          </p>
        </div>
        {canLink && (
          <Btn variant="secondary" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? 'Close matching' : 'Link supplier'}
          </Btn>
        )}
      </div>
      {open && canLink && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block">Find the matching shared supplier</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              style={{
                background: 'var(--aurora-surface)',
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text)',
              }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search supplier name or code"
            />
          </label>
          {candidates.error && (
            <p role="alert" className="workspace-notice">
              {candidates.error}
            </p>
          )}
          {candidates.loading ? (
            <p role="status" className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Searching suppliers…
            </p>
          ) : candidates.data?.data.length ? (
            <div className="space-y-2">
              {candidates.data.data.map((candidate) => (
                <div
                  key={candidate.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <span className="text-sm" style={{ color: 'var(--aurora-text)' }}>
                    {candidate.name}
                    {candidate.legalName && candidate.legalName !== candidate.name
                      ? ` · ${candidate.legalName}`
                      : ''}
                    {candidate.supplierCode ? ` · ${candidate.supplierCode}` : ''}
                    {candidate.tin ? ` · TIN ${candidate.tin}` : ''}
                  </span>
                  <Btn size="xs" loading={busy} disabled={busy} onClick={() => link(candidate.id)}>
                    Match this supplier
                  </Btn>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              No matching supplier in this company. Create or correct its shared supplier record,
              then search again.
            </p>
          )}
          {error && (
            <p role="alert" className="workspace-notice">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
