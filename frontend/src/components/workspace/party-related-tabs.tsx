'use client';
import { useState } from 'react';
import { Btn, StatusBadge } from '@/components/ui';
import { downloadBinaryGet } from '@/lib/export-download';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';

/** One related record in the shape every profile section returns (party linkage, PR-4). */
export type RelatedRow = {
  id: string;
  number: string;
  date: string | null;
  amount: string | null;
  currency: string | null;
  status: string | null;
  detail: string | null;
  link: { kind: string; id: string } | null;
};
export type RelatedSection = { section: string; rows: RelatedRow[]; total: number };
type Kind = 'supplier' | 'customer';
type Section = { id: string; label: string; permission: string; empty: string };

const SECTIONS: Record<Kind, Section[]> = {
  supplier: [
    {
      id: 'payments',
      label: 'Payments',
      permission: 'supplier-payments.view',
      empty: 'No payments recorded for this supplier.',
    },
    {
      id: 'cash',
      label: 'Cash Desk',
      permission: 'cash_desk.view',
      empty: 'No Cash Desk movements name this supplier.',
    },
    {
      id: 'expenses',
      label: 'Expenses',
      permission: 'expenses.view',
      empty: 'No expenses are linked to this supplier.',
    },
    {
      id: 'invoices',
      label: 'Supplier invoices',
      permission: 'supplier_invoices.list',
      empty: 'No supplier invoices for this supplier.',
    },
    {
      id: 'grns',
      label: 'Goods received',
      permission: 'grn.list',
      empty: 'No goods received from this supplier.',
    },
    {
      id: 'purchase-orders',
      label: 'Purchase orders',
      permission: 'purchases.view',
      empty: 'No purchase orders for this supplier.',
    },
    {
      id: 'desk-invoices',
      label: 'Invoice Desk',
      permission: 'invoice_desk.view',
      empty: 'No Invoice Desk invoices are linked to this supplier.',
    },
    {
      id: 'notebook',
      label: 'NoteBook',
      permission: 'records.view',
      empty: 'No NoteBook records are linked to this supplier.',
    },
    {
      id: 'contracts',
      label: 'Contracts',
      permission: 'contracts.view',
      empty: 'No contracts are linked to this supplier.',
    },
    {
      id: 'loans',
      label: 'Loans',
      permission: 'loans.read',
      empty: 'No loans name this supplier as the lender.',
    },
    {
      id: 'debts',
      label: 'Debts',
      permission: 'debts.read',
      empty: 'No debts are linked to this supplier.',
    },
    {
      id: 'contacts',
      label: 'Contacts',
      permission: 'contact_persons.list',
      empty: 'No contact persons recorded.',
    },
    {
      id: 'communications',
      label: 'Communications',
      permission: 'communication_logs.list',
      empty: 'No communications logged.',
    },
    {
      id: 'documents',
      label: 'Documents',
      permission: 'documents.view',
      empty: 'No documents are filed for this supplier.',
    },
  ],
  customer: [
    {
      id: 'payments',
      label: 'Payments',
      permission: 'customer-payments.view',
      empty: 'No payments recorded for this customer.',
    },
    {
      id: 'cash',
      label: 'Cash Desk',
      permission: 'cash_desk.view',
      empty: 'No Cash Desk movements name this customer.',
    },
    {
      id: 'desk-sales',
      label: 'Sales Desk',
      permission: 'sales_desk.view',
      empty: 'No Sales Desk sales are linked to this customer.',
    },
    {
      id: 'credit-notes',
      label: 'Credit notes',
      permission: 'receivables.view',
      empty: 'No credit notes for this customer.',
    },
    {
      id: 'refunds',
      label: 'Refunds',
      permission: 'refunds.view',
      empty: 'No refunds for this customer.',
    },
    {
      id: 'quotations',
      label: 'Quotations',
      permission: 'quotations.view',
      empty: 'No quotations for this customer.',
    },
    {
      id: 'proformas',
      label: 'Proformas',
      permission: 'proformas.view',
      empty: 'No proforma invoices for this customer.',
    },
    {
      id: 'delivery-notes',
      label: 'Delivery notes',
      permission: 'delivery_notes.view',
      empty: 'No delivery notes for this customer.',
    },
    {
      id: 'packages',
      label: 'Packages',
      permission: 'customers.view',
      empty: 'No returnable package balances.',
    },
    {
      id: 'notebook',
      label: 'NoteBook',
      permission: 'records.view',
      empty: 'No NoteBook records are linked to this customer.',
    },
    {
      id: 'contracts',
      label: 'Contracts',
      permission: 'contracts.view',
      empty: 'No contracts are linked to this customer.',
    },
    {
      id: 'contacts',
      label: 'Contacts',
      permission: 'contact_persons.list',
      empty: 'No contact persons recorded.',
    },
    {
      id: 'communications',
      label: 'Communications',
      permission: 'communication_logs.list',
      empty: 'No communications logged.',
    },
    {
      id: 'documents',
      label: 'Documents',
      permission: 'documents.view',
      empty: 'No documents are filed for this customer.',
    },
  ],
};

/**
 * Where a related row opens. Records with their own page open it; registers that honour
 * `?record=` or `?search=` open filtered; the rest open their list. Rows without a route
 * stay plain text rather than a guessed link.
 */
export function relatedHref(row: RelatedRow): string | null {
  if (!row.link) return null;
  const id = encodeURIComponent(row.link.id);
  switch (row.link.kind) {
    case 'cash-movement':
      return `/cash-desk?record=${id}`;
    case 'expense':
      return `/finance/expenses?search=${encodeURIComponent(row.number)}`;
    case 'record':
      return `/records?record=${id}`;
    case 'purchase-order':
      return `/operations/purchase-orders/${id}`;
    case 'desk-invoice':
      return `/invoice-desk?record=${id}`;
    case 'desk-sale':
      return `/sales-desk/sales/${id}`;
    case 'loan':
      return `/group-control/loans-debts/loans/${id}`;
    case 'document':
      return `/group-control/documents/${id}`;
    case 'supplier-invoice':
      return '/procurement/supplier-invoices';
    case 'grn':
      return '/procurement/grns';
    case 'contract':
      return '/group-control/contracts';
    case 'debt':
      return '/group-control/loans-debts';
    case 'customer-payment':
      return '/finance/payments';
    case 'credit-note':
      return '/finance/credit-notes';
    case 'refund':
      return '/finance/refunds';
    default:
      return null;
  }
}

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const money = (amount: string, currency: string | null) =>
  `${currency ? `${currency} ` : ''}${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Everything related to a party, one lazily loaded section at a time (party linkage, PR-4).
 * Sections appear only when the reader holds the register's own permission; the backend
 * enforces the same, so the list is never wider than what the reader may open.
 */
export function PartyRelatedTabs({ kind, partyId }: { kind: Kind; partyId: string }) {
  const { hasPermission } = useAuth();
  const sections = SECTIONS[kind].filter((s) => hasPermission(s.permission));
  const [active, setActive] = useState('');
  const [exportNote, setExportNote] = useState('');
  const current = sections.find((s) => s.id === active) ?? sections[0];
  // Party linkage (PR-6): one NoteBook statement across every record of the party.
  async function exportStatement(format: 'pdf' | 'csv') {
    setExportNote('');
    try {
      await downloadBinaryGet(
        `/records/party-statement/export?${kind}Id=${encodeURIComponent(partyId)}&format=${format}`,
        `notebook-statement.${format}`,
      );
      setExportNote('Download started.');
    } catch (error) {
      setExportNote(error instanceof Error ? error.message : 'Unable to export the statement.');
    }
  }
  // Party linkage (Phase 3 PR-6): a supplier payment downloads as a remittance advice.
  async function remittance(row: RelatedRow) {
    setExportNote('');
    try {
      await downloadBinaryGet(
        `/supplier-payments/${encodeURIComponent(row.id)}/remittance?format=pdf`,
        `remittance-${row.number}.pdf`,
      );
      setExportNote('Download started.');
    } catch (error) {
      setExportNote(error instanceof Error ? error.message : 'Unable to export the remittance.');
    }
  }
  const result = useWorkspaceResource<RelatedSection>(
    `/party-profile/${kind}s/${encodeURIComponent(partyId)}/${current?.id ?? ''}`,
    {},
    !!current && !!partyId,
  );
  if (!sections.length)
    return (
      <p className="partner-profile-history-note">
        No related sections are available with your permissions.
      </p>
    );
  const data = result.data;
  return (
    <div className="space-y-4">
      <nav className="party-related-nav" aria-label="Related records">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === current?.id}
            onClick={() => setActive(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {current?.id === 'notebook' && hasPermission('records.export') && (
        <div className="party-related-actions">
          <Btn variant="secondary" onClick={() => void exportStatement('pdf')}>
            NoteBook statement PDF
          </Btn>
          <Btn variant="secondary" onClick={() => void exportStatement('csv')}>
            NoteBook statement CSV
          </Btn>
          {exportNote && (
            <p role="status" className="partner-profile-history-note">
              {exportNote}
            </p>
          )}
        </div>
      )}
      {result.error ? (
        <p role="alert" className="partner-profile-history-note">
          {result.error}{' '}
          <button type="button" className="underline" onClick={result.reload}>
            Retry
          </button>
        </p>
      ) : result.loading || !data ? (
        <p role="status" className="partner-profile-history-note">
          Loading {current?.label.toLowerCase()}…
        </p>
      ) : !data.rows.length ? (
        <p className="partner-profile-history-note">{current?.empty}</p>
      ) : (
        <>
          <p className="partner-profile-history-note">
            {data.total > data.rows.length
              ? `Showing the latest ${data.rows.length} of ${data.total}.`
              : `${data.total} record${data.total === 1 ? '' : 's'}.`}
          </p>
          {data.rows.map((row) => {
            const href = relatedHref(row);
            return (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div>
                  <p className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                    {href ? <Link href={href}>{row.number}</Link> : row.number}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                    {[row.date ? shortDate(row.date) : null, row.detail]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="text-right">
                  {row.amount != null && (
                    <p className="font-semibold">{money(row.amount, row.currency)}</p>
                  )}
                  {row.status && (
                    <div className="mt-1 flex justify-end">
                      <StatusBadge status={row.status} />
                    </div>
                  )}
                  {kind === 'supplier' && current?.id === 'payments' && (
                    <div className="mt-1 flex justify-end">
                      <Btn size="xs" variant="secondary" onClick={() => void remittance(row)}>
                        Remittance PDF
                      </Btn>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {exportNote && current?.id !== 'notebook' && (
            <p role="status" className="partner-profile-history-note">
              {exportNote}
            </p>
          )}
        </>
      )}
    </div>
  );
}
