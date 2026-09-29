'use client';
import { useState } from 'react';
import { Btn, FormInput, FormSelect } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendPatch } from '@/lib/api-client';
import { WorkspaceLink } from './workspace-navigation';
import { notifyDeskSaved } from './linked-desk-changes';
import { money } from '@/features/invoice-desk/types';
type Candidate = {
  id: string;
  salesOrderNumber?: string;
  supplierInvoiceNumber?: string;
  totalAmount: string;
  currency: string;
  status: string;
};
export function BusinessTransactionLink({
  kind,
  id,
  companyId,
  canonicalId,
  reload,
}: {
  kind: 'sale' | 'invoice';
  id: string;
  companyId: string;
  canonicalId?: string | null;
  reload: () => void;
}) {
  const { hasPermission } = useAuth();
  const sale = kind === 'sale',
    app = sale ? 'sales-desk' : 'invoice-desk';
  const allowed =
    hasPermission(sale ? 'sales_desk.manage' : 'invoice_desk.manage') &&
    hasPermission(sale ? 'sales.view' : 'supplier_invoices.view') &&
    hasPermission(sale ? 'customers.view' : 'suppliers.view') &&
    (sale || hasPermission('supplier_invoices.list'));
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const candidates = useWorkspaceResource<{ data: Candidate[] }>(
    sale ? '/sales-orders' : '/supplier-invoices',
    { companyId, search, page: 1, limit: 20 },
    open && allowed && !canonicalId && search.trim().length > 1,
  );
  if (canonicalId)
    return (
      <p className="workspace-notice">
        <strong>Linked business record.</strong> This direct entry is retained as history and
        excluded from direct financial totals.{' '}
        <WorkspaceLink
          href={
            sale
              ? `/sales-desk/sales/${encodeURIComponent(canonicalId)}`
              : `/invoice-desk?view=invoices&businessRecord=${encodeURIComponent(canonicalId)}`
          }
        >
          Open the business transaction
        </WorkspaceLink>
      </p>
    );
  if (!allowed) return null;
  async function link() {
    if (busy || !confirmed || !selected) return;
    setBusy(true);
    setError('');
    try {
      await backendPatch(
        sale
          ? `/sales-desk/sales/${encodeURIComponent(id)}/business-link`
          : `/invoice-desk/invoices/${encodeURIComponent(id)}/business-link`,
        { canonicalId: selected },
      );
      notifyDeskSaved(app);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link this record.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-lg border p-4 space-y-3">
      <Btn variant="secondary" onClick={() => setOpen(!open)}>
        Match to an existing business transaction
      </Btn>
      {open && (
        <>
          <p>
            Use this only when both entries record the same transaction. It preserves this history
            and makes the business record authoritative. Entries with payments or accounting history
            need reconciliation first.
          </p>
          <FormInput
            label="Find business reference"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected('');
              setConfirmed(false);
            }}
          />
          <FormSelect
            label="Matching business transaction"
            value={selected}
            options={[
              { value: '', label: 'Select a matching record' },
              ...(candidates.data?.data ?? []).map((c) => ({
                value: c.id,
                label: `${c.salesOrderNumber ?? c.supplierInvoiceNumber} · ${money(String(c.totalAmount), c.currency)} · ${c.status}`,
              })),
            ]}
            onChange={(e) => {
              setSelected(e.target.value);
              setConfirmed(false);
            }}
          />
          {candidates.loading && search.length > 1 && <p role="status">Finding transactions…</p>}
          {candidates.error && <p role="alert">{candidates.error}</p>}
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed both records and they describe the same transaction.
          </label>
          <Btn disabled={!selected || !confirmed || busy} loading={busy} onClick={link}>
            Link reviewed transaction
          </Btn>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
