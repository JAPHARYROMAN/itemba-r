'use client';

import { useState } from 'react';
import { Btn, Card } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { notifyDeskSaved } from '@/components/workspace/linked-desk-changes';
import { backendPatch } from '@/lib/api-client';

interface UnlinkedCustomer {
  id: string;
  companyId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company: { name: string };
  _count: { sales: number };
}

interface CustomerChoice {
  id: string;
  name: string;
  legalName?: string | null;
  customerCode?: string | null;
  tin?: string | null;
  companyId: string;
}

export function SalesCustomerReconciliation() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('sales_desk.view') && hasPermission('customers.view');
  const canLink =
    canView && hasPermission('sales_desk.manage') && hasPermission('customers.update');
  const result = useWorkspaceResource<UnlinkedCustomer[]>(
    '/sales-desk/customers/unlinked',
    {},
    canView,
  );
  const [message, setMessage] = useState('');

  if (!canView || (result.loading && !result.data) || result.error || !result.data?.length)
    return result.error ? (
      <Card className="mt-5 p-4">
        <p role="alert" className="workspace-notice">
          Could not load older Sales Desk customer records: {result.error}
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
          Older Sales Desk customer records
        </h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          These records need an explicit match. Their sales and payments are preserved; link each
          one to the correct shared customer to bring it into the shared profile.
        </p>
      </div>
      {message && (
        <p role="status" className="workspace-notice">
          {message}
        </p>
      )}
      <div className="space-y-3">
        {result.data.map((customer) => (
          <UnlinkedCustomerRow
            key={customer.id}
            customer={customer}
            canLink={canLink}
            onLinked={() => {
              setMessage(`${customer.name} is now linked to the shared customer profile.`);
              result.reload();
            }}
          />
        ))}
      </div>
    </Card>
  );
}

function UnlinkedCustomerRow({
  customer,
  canLink,
  onLinked,
}: {
  customer: UnlinkedCustomer;
  canLink: boolean;
  onLinked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(customer.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const candidates = useWorkspaceResource<{
    data: CustomerChoice[];
  }>(
    '/customers',
    { companyId: customer.companyId, search: search.trim(), page: 1, limit: 20 },
    open && canLink && search.trim().length > 0,
  );

  async function link(canonicalCustomerId: string) {
    if (busy || !canLink) return;
    setBusy(true);
    setError('');
    try {
      await backendPatch(`/sales-desk/customers/${encodeURIComponent(customer.id)}/link`, {
        canonicalCustomerId,
      });
      notifyDeskSaved('sales-desk');
      onLinked();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not link this customer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium" style={{ color: 'var(--aurora-text)' }}>
            {customer.name}
          </p>
          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            {customer.company.name} · {customer._count.sales} Sales Desk sale
            {customer._count.sales === 1 ? '' : 's'}
            {customer.email ? ` · ${customer.email}` : ''}
          </p>
        </div>
        {canLink && (
          <Btn variant="secondary" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? 'Close matching' : 'Link customer'}
          </Btn>
        )}
      </div>
      {open && canLink && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block">Find the matching shared customer</span>
            <input
              className="w-full rounded-md border px-3 py-2"
              style={{
                background: 'var(--aurora-surface)',
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text)',
              }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customer name or code"
            />
          </label>
          {candidates.error && (
            <p role="alert" className="workspace-notice">
              {candidates.error}
            </p>
          )}
          {candidates.loading ? (
            <p role="status" className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Searching customers…
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
                    {candidate.customerCode ? ` · ${candidate.customerCode}` : ''}
                    {candidate.tin ? ` · TIN ${candidate.tin}` : ''}
                  </span>
                  <Btn size="xs" loading={busy} disabled={busy} onClick={() => link(candidate.id)}>
                    Match this customer
                  </Btn>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              No matching customer in this company. Create or correct its shared customer record,
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
