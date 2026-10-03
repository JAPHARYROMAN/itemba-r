'use client';
import { Btn, Modal } from '@/components/ui';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import type { PartyBalance } from './party-balance';
import { openPartyIn, type PartyKind } from './party-links';
import './party-card.css';

type PartyDetail = {
  id: string;
  name: string;
  supplierCode?: string | null;
  customerCode?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  company?: { name: string } | null;
};
const money = (amount: string, currency: string) =>
  `${currency} ${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The same peek at a party from every app (party linkage, Phase 2 PR-5): who they are,
 * what they owe or are owed (from the resolver), when they last paid, and where to open
 * them. Reads only with the profile permission; actions appear only for apps the reader
 * may open.
 */
export function PartyCard({
  kind,
  partyId,
  onClose,
}: {
  kind: PartyKind;
  partyId: string;
  onClose: () => void;
}) {
  const { hasPermission } = useAuth();
  const canView = hasPermission(kind === 'supplier' ? 'suppliers.view' : 'customers.view');
  const detail = useWorkspaceResource<PartyDetail>(
    `/${kind}s/${encodeURIComponent(partyId)}`,
    {},
    canView && !!partyId,
  );
  const balance = useWorkspaceResource<PartyBalance>(
    `/party-balance/${kind}s/${encodeURIComponent(partyId)}`,
    {},
    canView && !!partyId,
  );
  const label = kind === 'supplier' ? 'Supplier' : 'Customer';
  const name = detail.data?.name ?? label;
  const actions = [
    { label: 'Open profile', app: 'profile' as const, show: canView },
    {
      label: 'Cash Desk movements',
      app: 'cash-desk' as const,
      show: hasPermission('cash_desk.view'),
    },
    { label: 'NoteBook', app: 'records' as const, show: hasPermission('records.view') },
    { label: 'Statements', app: 'statements' as const, show: canView },
    { label: 'Reports', app: 'reports' as const, show: hasPermission('operations.reports.view') },
  ].filter((a) => a.show);
  const b = balance.data;
  // Overdue per currency = ERP overdue + desk overdue, as the resolver splits them.
  const overdue = b
    ? [...new Set([...b.erp.map((e) => e.currency), ...b.desk.map((d) => d.currency)])]
        .map((currency) => ({
          currency,
          amount: (
            Number(b.erp.find((e) => e.currency === currency)?.overdue ?? 0) +
            Number(b.desk.find((d) => d.currency === currency)?.overdue ?? 0)
          ).toFixed(2),
        }))
        .filter((o) => Number(o.amount) > 0)
    : [];
  return (
    <Modal
      open
      title={name}
      size="sm"
      subtitle={label}
      onClose={onClose}
      footer={
        <Btn variant="secondary" onClick={onClose}>
          Close
        </Btn>
      }
    >
      {!canView ? (
        <p className="desk-muted">Profile access is needed to peek at this {kind}.</p>
      ) : (
        <div className="party-card">
          {detail.error && (
            <p role="alert" className="desk-error">
              {detail.error}
            </p>
          )}
          {detail.data && (
            <dl className="party-card-facts">
              <div>
                <dt>Code</dt>
                <dd>{detail.data.supplierCode ?? detail.data.customerCode ?? '—'}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{detail.data.phone ?? '—'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{detail.data.email ?? '—'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{detail.data.status ?? '—'}</dd>
              </div>
            </dl>
          )}
          {balance.loading ? (
            <p role="status" className="desk-muted">
              Computing balance…
            </p>
          ) : b ? (
            <div
              className="party-card-balance"
              aria-label="Balance from the party balance resolver"
            >
              {b.total.length ? (
                b.total.map((t) => <strong key={t.currency}>{money(t.amount, t.currency)}</strong>)
              ) : (
                <strong>Nothing outstanding</strong>
              )}
              <small>
                {overdue.length
                  ? `Overdue ${overdue.map((o) => money(o.amount, o.currency)).join(' · ')}`
                  : 'Nothing overdue'}
                {' · '}
                {b.lastPaymentAt
                  ? `Last payment ${shortDate(b.lastPaymentAt)}`
                  : 'No payment recorded'}
              </small>
            </div>
          ) : balance.error ? (
            <p className="desk-muted">Balance unavailable.</p>
          ) : null}
          <nav className="party-card-actions" aria-label="Open in">
            {actions.map((a) => (
              <Link
                key={a.app}
                href={openPartyIn(a.app, kind, partyId)}
                className="desk-text-button"
              >
                {a.label} →
              </Link>
            ))}
          </nav>
        </div>
      )}
    </Modal>
  );
}
