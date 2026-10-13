'use client';

import { useState } from 'react';
import { Btn, FormDateField, StatusBadge, WorkspaceTable } from '@/components/ui';
import { WorkspaceLink } from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import {
  StatementHistoryWarning,
  type StatementSettlementHistory,
} from '@/components/workspace/statement-history-warning';
import { backendPost } from '@/lib/api-client';
import { downloadBinaryExport } from '@/lib/export-download';
import { performanceDate, performanceDates } from './customer-performance-dates';
import { performanceMoney } from './customer-performance-types';
import './customer-performance.css';

export type StatementSelection = {
  companyId: string;
  customerId: string;
  currency: string;
  dateFrom: string;
  dateTo: string;
  divisionId?: string;
  branchId?: string;
};
export type SavedCustomerStatement = {
  id: string;
  statementRunNumber: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  currency?: string;
  settlementHistory?: StatementSettlementHistory;
};
type StatementDetail = {
  customerName: string | null;
  currency: string;
  dateFrom: string;
  dateTo: string;
  openingBalance: string;
  totalDebits: string;
  totalCredits: string;
  closingBalance: string;
  openInvoiceBalance?: string;
  customerCredit?: string;
  netBalance?: string;
  generatedAt: string;
  agingAsOf?: string;
  runId?: string;
  statementRunNumber?: string;
  warnings?: string[];
  settlementHistory?: StatementSettlementHistory;
  contentHash?: string;
  scope?: { companyId?: string; divisionId?: string; branchId?: string; unrestricted: boolean };
  scopeLabel?: string;
  company?: { name: string; code?: string | null; email?: string | null; phone?: string | null };
  customer?: { name: string; customerCode?: string | null; address?: string | null };
  lines: {
    date: string;
    type: string;
    reference: string;
    description: string;
    sourceId: string;
    sourceUrl?: string | null;
    debit: string;
    credit: string;
    balance: string;
  }[];
  aging?: {
    current: number | string;
    days1_30: number | string;
    days31_60: number | string;
    days61_90: number | string;
    over90: number | string;
  };
};

/** Preview and export always use the same applied selection or immutable saved run. */
export function CustomerStatementWorkspace({
  customer,
  initialSelection,
  savedRuns = [],
  onSaved,
}: {
  customer: { id: string; name: string; companyId: string };
  initialSelection?: StatementSelection;
  savedRuns?: SavedCustomerStatement[];
  onSaved?: () => void;
}) {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = !authLoading && hasPermission('customer_statements.view');
  const canSave = hasPermission('customer_statements.generate');
  const [draft, setDraft] = useState<StatementSelection>(
    () =>
      initialSelection ?? {
        companyId: customer.companyId,
        customerId: customer.id,
        currency: 'TZS',
        ...performanceDates('month'),
      },
  );
  const [selection, setSelection] = useState(draft);
  const [runId, setRunId] = useState('');
  const [saved, setSaved] = useState<SavedCustomerStatement[]>([]);
  const [busy, setBusy] = useState<'pdf' | 'excel' | 'save' | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const query: Record<string, string> = runId ? {} : { ...selection };
  const resource = useWorkspaceResource<StatementDetail>(
    runId
      ? `/customer-statements/${encodeURIComponent(runId)}/detail`
      : '/customer-statements/detail',
    query,
    canView,
  );
  const detail = resource.data;
  const changed = JSON.stringify(draft) !== JSON.stringify(selection);
  const allRuns = [
    ...saved,
    ...savedRuns.filter((run) => !saved.some((item) => item.id === run.id)),
  ];

  async function exportStatement(format: 'pdf' | 'excel') {
    if (!detail || busy || !canView) return;
    setBusy(format);
    setActionError('');
    try {
      await downloadBinaryExport(
        `/customer-statements/export/${format}`,
        runId
          ? { runId }
          : { ...selection, ...(detail.contentHash ? { expectedHash: detail.contentHash } : {}) },
        `customer-statement.${format === 'pdf' ? 'pdf' : 'xlsx'}`,
      );
      setNotice(`${format === 'pdf' ? 'PDF' : 'Excel'} statement downloaded.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to download statement.');
    } finally {
      setBusy(null);
    }
  }

  async function saveStatement() {
    if (!detail || busy || !canSave || runId) return;
    setBusy('save');
    setActionError('');
    try {
      const run = await backendPost<SavedCustomerStatement>('/customer-statements/generate', {
        companyId: selection.companyId,
        customerId: selection.customerId,
        currency: selection.currency,
        periodStart: selection.dateFrom,
        periodEnd: selection.dateTo,
        ...(selection.divisionId ? { divisionId: selection.divisionId } : {}),
        ...(selection.branchId ? { branchId: selection.branchId } : {}),
        ...(detail.contentHash ? { expectedHash: detail.contentHash } : {}),
      });
      setSaved((previous) => [run, ...previous]);
      setRunId(run.id);
      setNotice('Statement saved. Preview and downloads now use this saved snapshot.');
      onSaved?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to save statement.');
    } finally {
      setBusy(null);
    }
  }

  if (!canView)
    return (
      <p className="customer-performance-note">
        Statement viewing access is required to preview or download an account statement.
      </p>
    );
  return (
    <section className="customer-statement" aria-label={`Account statement for ${customer.name}`}>
      <div className="customer-performance-heading">
        <div>
          <h2>Customer statement</h2>
          <p>Review the account, then download or save a statement.</p>
        </div>
        {detail && <StatusBadge status={runId ? 'Saved snapshot' : 'Live preview'} />}
      </div>
      <form
        className="customer-performance-filters"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (!draft.dateFrom || !draft.dateTo || draft.dateFrom > draft.dateTo) {
            setActionError('Choose a valid statement period.');
            return;
          }
          setRunId('');
          setSelection({ ...draft });
          setNotice('');
          setActionError('');
          resource.reload();
        }}
      >
        <FormDateField
          label="Statement from"
          value={draft.dateFrom}
          max={draft.dateTo}
          disabled={!!busy}
          onChange={(dateFrom) => setDraft((value) => ({ ...value, dateFrom }))}
          required
        />
        <FormDateField
          label="Statement to"
          value={draft.dateTo}
          min={draft.dateFrom}
          disabled={!!busy}
          onChange={(dateTo) => setDraft((value) => ({ ...value, dateTo }))}
          required
        />
        <label>
          Statement currency
          <select
            value={draft.currency}
            disabled={!!busy}
            onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))}
          >
            {['TZS', 'USD', 'EUR', 'KES', 'GBP', 'UGX'].map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </label>
        <Btn variant="secondary" type="submit" disabled={!!busy}>
          Preview statement
        </Btn>
      </form>
      {changed && (
        <p className="customer-performance-note">
          Dates or currency have changed. Preview statement to apply them; downloads use the
          displayed statement.
        </p>
      )}
      {notice && (
        <p role="status" className="customer-performance-notice">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="customer-performance-error">
          {actionError}
        </p>
      )}
      {resource.loading && <p role="status">Loading statement…</p>}
      {resource.error && (
        <div role="alert" className="customer-performance-error">
          {resource.error}{' '}
          <Btn onClick={resource.reload} variant="secondary">
            Retry statement
          </Btn>
        </div>
      )}
      {detail && (
        <>
          <div className="customer-statement-identity">
            <strong>{detail.company?.name ?? 'Customer account'}</strong>
            <span>
              {detail.customer?.name ?? detail.customerName ?? customer.name}
              {detail.customer?.customerCode ? ` · ${detail.customer.customerCode}` : ''}
            </span>
            {detail.customer?.address && <span>{detail.customer.address}</span>}
            <span>
              Scope:{' '}
              {detail.scopeLabel ??
                (detail.scope?.branchId
                  ? 'Branch account'
                  : detail.scope?.divisionId
                    ? 'Division account'
                    : detail.scope?.unrestricted
                      ? 'Company account'
                      : 'Authorised organisation scope')}
            </span>
          </div>
          <p className="customer-performance-note">
            {detail.statementRunNumber ? `${detail.statementRunNumber} · ` : ''}
            {performanceDate(detail.dateFrom, true)} – {performanceDate(detail.dateTo, true)} ·{' '}
            {detail.currency} · Prepared{' '}
            {new Date(detail.generatedAt).toLocaleString('en-GB', {
              timeZone: 'Africa/Nairobi',
              dateStyle: 'medium',
              timeStyle: 'short',
            })}{' '}
            EAT
          </p>
          <StatementHistoryWarning history={detail.settlementHistory} currency={detail.currency} />
          {detail.warnings?.map((warning) => (
            <p key={warning} className="customer-performance-note">
              {warning}
            </p>
          ))}
          <div className="customer-performance-metrics">
            {[
              ['Opening balance', detail.openingBalance],
              ['Debits in period', detail.totalDebits],
              ['Credits in period', detail.totalCredits],
              ['Closing balance', detail.closingBalance],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{performanceMoney(value, detail.currency)}</strong>
              </div>
            ))}
          </div>
          {detail.openInvoiceBalance !== undefined && (
            <dl className="customer-performance-account-totals">
              <div>
                <dt>Open invoices at period end</dt>
                <dd>{performanceMoney(detail.openInvoiceBalance, detail.currency)}</dd>
              </div>
              <div>
                <dt>Customer credit / deposits at period end</dt>
                <dd>{performanceMoney(detail.customerCredit, detail.currency)}</dd>
              </div>
              <div>
                <dt>Net amount due at period end</dt>
                <dd>{performanceMoney(detail.netBalance, detail.currency)}</dd>
              </div>
            </dl>
          )}
          <WorkspaceTable mobile="scroll" label="Statement transactions">
            <caption className="sr-only">
              Account transactions with running balance in {detail.currency}
            </caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference / description</th>
                <th className="customer-performance-number">Debit</th>
                <th className="customer-performance-number">Credit</th>
                <th className="customer-performance-number">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{performanceDate(detail.dateFrom)}</td>
                <td>Opening balance</td>
                <td>—</td>
                <td>—</td>
                <td className="customer-performance-number">
                  {performanceMoney(detail.openingBalance, detail.currency)}
                </td>
              </tr>
              {detail.lines.map((line, index) => (
                <tr key={`${line.sourceId}-${index}`}>
                  <td>{performanceDate(line.date)}</td>
                  <td>
                    {line.sourceUrl ? (
                      <WorkspaceLink href={line.sourceUrl}>{line.reference}</WorkspaceLink>
                    ) : (
                      <strong>{line.reference}</strong>
                    )}
                    <small>
                      {line.type.replaceAll('_', ' ')} · {line.description}
                    </small>
                  </td>
                  <td className="customer-performance-number">
                    {performanceMoney(line.debit, detail.currency)}
                  </td>
                  <td className="customer-performance-number">
                    {performanceMoney(line.credit, detail.currency)}
                  </td>
                  <td className="customer-performance-number">
                    {performanceMoney(line.balance, detail.currency)}
                  </td>
                </tr>
              ))}
              {!detail.lines.length && (
                <tr>
                  <td colSpan={5}>No account movements in this period.</td>
                </tr>
              )}
              <tr>
                <td>{performanceDate(detail.dateTo)}</td>
                <td>Closing balance</td>
                <td className="customer-performance-number">
                  {performanceMoney(detail.totalDebits, detail.currency)}
                </td>
                <td className="customer-performance-number">
                  {performanceMoney(detail.totalCredits, detail.currency)}
                </td>
                <td className="customer-performance-number">
                  <strong>{performanceMoney(detail.closingBalance, detail.currency)}</strong>
                </td>
              </tr>
            </tbody>
          </WorkspaceTable>
          {detail.aging && (
            <details className="customer-performance-explainer">
              <summary>
                Invoice aging at {performanceDate(detail.agingAsOf ?? detail.dateTo, true)}
              </summary>
              <dl className="customer-performance-account-totals">
                {[
                  ['Current', detail.aging.current],
                  ['1–30 days', detail.aging.days1_30],
                  ['31–60 days', detail.aging.days31_60],
                  ['61–90 days', detail.aging.days61_90],
                  ['Over 90 days', detail.aging.over90],
                ].map(([label, amount]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{performanceMoney(amount, detail.currency)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <div className="customer-performance-actions">
            <Btn
              variant="secondary"
              onClick={() => exportStatement('pdf')}
              disabled={!!busy}
              loading={busy === 'pdf'}
            >
              Download PDF
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => exportStatement('excel')}
              disabled={!!busy}
              loading={busy === 'excel'}
            >
              Download Excel
            </Btn>
            {canSave && !runId && (
              <Btn onClick={saveStatement} disabled={!!busy} loading={busy === 'save'}>
                Save statement
              </Btn>
            )}
          </div>
        </>
      )}
      {!!allRuns.length && (
        <div className="customer-performance-saved">
          <h3>Saved statements</h3>
          <ul>
            {allRuns.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => {
                    setRunId(run.id);
                    setNotice('');
                    setActionError('');
                  }}
                >
                  {run.statementRunNumber}{' '}
                  <span>
                    {performanceDate(run.periodStart, true)} –{' '}
                    {performanceDate(run.periodEnd, true)}
                    {run.currency ? ` · ${run.currency}` : ''}
                  </span>
                </button>
                <StatementHistoryWarning
                  history={run.settlementHistory}
                  currency={run.currency ?? 'TZS'}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
