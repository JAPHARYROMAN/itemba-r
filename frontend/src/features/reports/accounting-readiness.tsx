'use client';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import {
  AccountingDraftBoundary,
  useAccountingEditor,
  useAccountingRefresh,
  useAccountingStateKey,
} from './accounting-drafts';
import { controlDefinitions, type ControlKind } from './accounting-controls-types';
import type { InvoiceSource } from './accounting-types';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { BookOpen, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { money, type Directory } from '@/features/invoice-desk/types';
import { AnalysisFilterForm, useAnalysisFilters } from './analysis-filters';
import './accounting-readiness.css';
import { CashAccounting } from './cash-accounting';

export function AccountingReadiness() {
  return (
    <AccountingDraftBoundary>
      <AccountingWorkspace />
    </AccountingDraftBoundary>
  );
}
function AccountingWorkspace() {
  const { tab, apply } = useAnalysisFilters('accounting');
  const { hasPermission } = useAuth();
  return (
    <>
      <nav className="accounting-workspaces" aria-label="Accounting workspaces">
        <button
          aria-current={!['cash', 'connections'].includes(tab) ? 'page' : undefined}
          onClick={() => apply({}, 'sales')}
        >
          Invoices
        </button>
        {hasPermission('cash_desk.view') && (
          <>
            <button
              aria-current={tab === 'cash' ? 'page' : undefined}
              onClick={() => apply({}, 'cash')}
            >
              Cash movements
            </button>
            <button
              aria-current={tab === 'connections' ? 'page' : undefined}
              onClick={() => apply({}, 'connections')}
            >
              Account connections
            </button>
          </>
        )}
      </nav>
      <nav className="accounting-links" aria-label="Period and accounting controls">
        {(Object.keys(controlDefinitions) as ControlKind[])
          .filter((kind) => hasPermission(`${controlDefinitions[kind].permission}.list`))
          .map((kind) => (
            <Link key={kind} href={`/accounting-engine/${kind}`}>
              {controlDefinitions[kind].title} →
            </Link>
          ))}
      </nav>
      {['cash', 'connections'].includes(tab) ? (
        <CashAccounting key={tab} connections={tab === 'connections'} />
      ) : (
        <InvoiceAccountingReadiness />
      )}
    </>
  );
}
function InvoiceAccountingReadiness() {
  const { hasPermission } = useAuth();
  const { filters, query, apply, tab } = useAnalysisFilters('accounting');
  const kind = tab === 'purchases' || !hasPermission('sales_desk.view') ? 'purchases' : 'sales';
  const allowed =
    hasPermission('journal_entries.view') &&
    hasPermission(kind === 'sales' ? 'sales_desk.view' : 'invoice_desk.view');
  const rows = useWorkspaceResource<InvoiceSource[]>(`/desk-posting/${kind}`, query, allowed);
  const directory = useWorkspaceResource<Directory>(
    kind === 'sales' ? '/sales-desk/directory' : '/invoice-desk/directory',
    {},
    allowed,
  );
  const open = useAccountingEditor();
  const key = useAccountingStateKey(kind);
  const [search, setSearch] = useWorkspaceState(`${key}.search`, '');
  const [status, setStatus] = useWorkspaceState(`${key}.status`, '');
  useAccountingRefresh(rows.reload);
  const pending = rows.data?.filter((r) => r.status !== 'Posted' && r.status !== 'Voided').length;
  const visible =
    rows.data?.filter(
      (r) =>
        (!status || r.status === status) &&
        r.reference.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <section className="accounting-readiness">
      <header className="reports-heading">
        <p className="reports-eyebrow">ITEMBA OS · ACCOUNTING</p>
        <h1>Bring the records together.</h1>
        <p>Review Desk documents, choose their accounts and trace each posting to the ledger.</p>
      </header>
      <div className="accounting-summary">
        <BookOpen size={27} />
        <div>
          <strong>
            {rows.loading
              ? 'Checking documents…'
              : rows.error
                ? 'Posting coverage unavailable'
                : `${pending ?? 0} documents need attention`}
          </strong>
          <p>
            Connect cash accounts, then review invoice and cash postings here. Tax splits, foreign
            currencies and intercompany loans need separate accounting workflows.
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh accounting"
          onClick={() => {
            rows.reload();
            directory.reload();
          }}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <div className="accounting-links">
        <Link href="/accounting-engine/bank-reconciliations">Reconcile statements →</Link>
        <Link href="/finance/journal-entries">Open journal entries →</Link>
      </div>
      <details>
        <summary>Change period & organisation</summary>
        <AnalysisFilterForm
          key={JSON.stringify(filters)}
          value={filters}
          directory={directory.data}
          onApply={(value) => apply(value, kind)}
        />
      </details>
      <div className="accounting-toolbar">
        <div role="group" aria-label="Posting source">
          {hasPermission('sales_desk.view') && (
            <button aria-pressed={kind === 'sales'} onClick={() => apply({}, 'sales')}>
              Sales invoices
            </button>
          )}
          {hasPermission('invoice_desk.view') && (
            <button aria-pressed={kind === 'purchases'} onClick={() => apply({}, 'purchases')}>
              Purchase invoices
            </button>
          )}
        </div>
        <label>
          Find document
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Invoice number"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['Unposted', 'Posted', 'Changed', 'Duplicate', 'Needs review', 'Voided'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      {rows.error && <p role="alert">{rows.error}</p>}
      {!allowed && <p>Your role needs journal access and access to Sales Desk or Invoice Desk.</p>}
      <div
        className="accounting-table"
        role="region"
        aria-label="Invoice posting register"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Ledger status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td>{row.reference}</td>
                <td>{row.date}</td>
                <td>{money(row.amount, row.currency)}</td>
                <td>
                  <span
                    className={`posting-status posting-${row.status.toLowerCase().replaceAll(' ', '-')}`}
                  >
                    {row.status}
                  </span>
                </td>
                <td>
                  <button
                    onClick={() => open({ kind: 'invoice-posting', id: row.id, sourceKind: kind })}
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.loading && !rows.error && !visible.length && (
          <p className="reports-empty">
            No documents in this view. Add an invoice in Sales Desk or Invoice Desk, or change the
            filters.
          </p>
        )}
      </div>
      <p className="accounting-note">
        Review existing ERP entries before posting previously recorded documents. This workflow
        detects journals linked through the Desk bridge; it cannot identify an unrelated manual
        entry as the same invoice. Amounts are posted as a single total; split-tax documents need a
        separate accounting workflow.
      </p>
    </section>
  );
}
