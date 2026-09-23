'use client';

import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { Activity, ArrowUpRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { money, localToday, type Directory } from '@/features/invoice-desk/types';
import { AnalysisFilterForm, FilterCaption, useAnalysisFilters } from './analysis-filters';
import { AnalysisGrid } from './analysis-table';
import type { Analysis } from './analysis-types';
import { commitments, cents, decimal, dueThrough, type Financing } from './group-health-data';
import './group-health.css';

export function GroupHealth() {
  const { hasPermission } = useAuth(),
    { filters, query, apply, href, tab } = useAnalysisFilters('health');
  const canSales = hasPermission('sales_desk.view'),
    canBuy = hasPermission('invoice_desk.view'),
    canCash = hasPermission('cash_desk.view'),
    canLoans = hasPermission('loans.read') && hasPermission('loan_schedules.list');
  const future = filters.to > localToday();
  const postingSales = useWorkspaceResource<Array<{ status: string }>>(
    '/desk-posting/sales',
    query,
    canSales && hasPermission('journal_entries.view') && !future,
  );
  const postingPurchases = useWorkspaceResource<Array<{ status: string }>>(
    '/desk-posting/purchases',
    query,
    canBuy && hasPermission('journal_entries.view') && !future,
  );
  const postingCash = useWorkspaceResource<Array<{ status: string }>>(
    '/cash-connections/movements',
    query,
    canCash && hasPermission('journal_entries.view') && !future,
  );
  const unlinkedPayments = useWorkspaceResource<Array<{ id: string }>>(
    '/cash-connections/unlinked-payments',
    query,
    canBuy && canCash && hasPermission('journal_entries.view') && !future,
  );
  const postingSources = [postingSales, postingPurchases, postingCash];
  const postingPending = postingSources
    .flatMap((s) => s.data ?? [])
    .filter((s) => !['Posted', 'Voided', 'Reversed', 'Cancelled'].includes(s.status)).length;
  const directory = useWorkspaceResource<Directory>(
    canSales
      ? '/sales-desk/directory'
      : canBuy
        ? '/invoice-desk/directory'
        : '/cash-desk/directory',
    {},
    canSales || canBuy || canCash,
  );
  const sales = useWorkspaceResource<Analysis>('/desk-reports/sales', query, canSales && !future),
    purchases = useWorkspaceResource<Analysis>('/desk-reports/purchases', query, canBuy && !future),
    cash = useWorkspaceResource<Analysis>('/desk-reports/cash', query, canCash && !future),
    loans = useWorkspaceResource<Financing>(
      '/desk-reports/financing/borrowings',
      query,
      canLoans && !future,
    ),
    internal = useWorkspaceResource<Financing>(
      '/desk-reports/financing/internal',
      query,
      canCash && !future,
    );
  const sources = [
    { name: 'Customer balances', allowed: canSales, resource: sales },
    { name: 'Supplier balances', allowed: canBuy, resource: purchases },
    { name: 'Cash Desk accounts', allowed: canCash, resource: cash },
    { name: 'ERP loans & schedules', allowed: canLoans, resource: loans },
    { name: 'Intercompany lending', allowed: canCash, resource: internal },
  ];
  const currencies = [
    ...new Set(sources.flatMap((s) => s.resource.data?.currencies.map((c) => c.currency) ?? [])),
  ].sort();
  const currency = filters.currency || currencies[0] || 'TZS';
  const selected = tab || 'health-commitments';
  const setSelected = (next: string) => apply({}, next);
  const cashBalance = cash.data?.currencies.find((c) => c.currency === currency)?.closing;
  const external = loans.data?.currencies.find((c) => c.currency === currency);
  const inter = internal.data?.currencies.find((c) => c.currency === currency);
  const validDate =
    /^\d{4}-\d{2}-\d{2}$/.test(filters.to) && Number.isFinite(new Date(filters.to).getTime());
  const due = commitments(
    purchases.data,
    loans.data,
    internal.data,
    currency,
    validDate ? filters.to : localToday(),
  );
  const tables = [due, ...(loans.data?.tables ?? []), ...(internal.data?.tables ?? [])].map(
    (t) => ({ ...t, rows: t.rows.filter((r) => r.currency === currency) }),
  );
  const chosen = tables.find((t) => t.id === selected) ?? tables[0];
  const alerts: string[] = [];
  const overdue = due.rows.filter((r) => String(r.dueDate) < filters.to);
  if (overdue.length)
    alerts.push(
      `${overdue.length} overdue payment obligation${overdue.length === 1 ? '' : 's'} in the connected sources.`,
    );
  if (
    validDate &&
    cashBalance !== undefined &&
    cents(cashBalance) < dueThrough(due.rows, filters.to, 7)
  )
    alerts.push(
      'Recorded cash is below known payments due through the next 7 days, including overdue amounts.',
    );
  const overdueSales = sales.data?.currencies.find((c) => c.currency === currency)?.overdue;
  if (overdueSales && cents(overdueSales) > 0n)
    alerts.push(`${money(overdueSales, currency)} in customer invoices is overdue.`);
  if (loans.data?.tables.find((t) => t.id === 'issues')?.rows.some((r) => r.currency === currency))
    alerts.push('Loan records need reconciliation. Open Loan reconciliation checks below.');
  if (
    internal.data?.tables
      .find((t) => t.id === 'internal')
      ?.rows.some((r) => r.currency === currency && r.check !== 'Matched')
  )
    alerts.push('An intercompany loan balance does not match its recorded repayments.');
  const cards = [
    {
      label: 'Recorded cash',
      value: cashBalance,
      available: !!cash.data,
      note: 'Cash Desk accounts; not bank-reconciled',
      target: 'cash',
      tab: 'accounts',
    },
    {
      label: 'Customers owe',
      value: sales.data?.currencies.find((c) => c.currency === currency)?.closing,
      available: !!sales.data,
      note: 'Sales Desk outstanding at the selected date',
      target: 'customers',
      tab: 'ageing',
    },
    {
      label: 'Suppliers owed',
      value: purchases.data?.currencies.find((c) => c.currency === currency)?.closing,
      available: !!purchases.data,
      note: 'Invoice Desk outstanding at the selected date',
      target: 'suppliers',
      tab: 'ageing',
    },
    {
      label: 'External loan principal',
      value: external?.principal,
      available: !!loans.data,
      note: 'ERP borrowing; interest shown in instalments',
      target: 'health',
      tab: 'borrowings',
    },
    {
      label: 'Intercompany receivable',
      value: inter?.receivable,
      available: !!internal.data,
      note: 'After eliminating both sides within this scope',
      target: 'health',
      tab: 'internal',
    },
    {
      label: 'Intercompany payable',
      value: inter?.payable,
      available: !!internal.data,
      note: 'After eliminating both sides within this scope',
      target: 'health',
      tab: 'internal',
    },
  ];
  return (
    <section className="group-health">
      <header className="reports-heading health-heading">
        <div>
          <p className="reports-eyebrow">ITEMBA OS · GROUP HEALTH</p>
          <h1>Know where you stand.</h1>
          <p>
            Your position at a chosen date, obligations ahead and the records that need attention.
          </p>
        </div>
        <button
          aria-label="Refresh group health"
          onClick={() => {
            directory.reload();
            sources.forEach((s) => {
              if (s.allowed) s.resource.reload();
            });
            postingSources.forEach((s) => s.reload());
            unlinkedPayments.reload();
          }}
        >
          <RefreshCw size={17} />
        </button>
      </header>
      {hasPermission('journal_entries.view') && (
        <Link className="health-entry" href={href('accounting')}>
          <div>
            <strong>Accounting readiness</strong>
            <p>
              {postingSources.some((s) => s.error)
                ? 'Some invoice or cash posting checks are unavailable.'
                : postingSources.some((s) => s.loading)
                  ? 'Checking invoice and cash postings…'
                  : `${postingPending} accessible invoices and cash movements need posting review in the selected period.`}{' '}
              {unlinkedPayments.error
                ? 'Unlinked payment checks are unavailable. '
                : unlinkedPayments.data?.length
                  ? `${unlinkedPayments.data.length} invoice payments also need a cash account. `
                  : ''}
              Cash movements and tax splits are not yet included.
            </p>
          </div>
          <ArrowUpRight size={22} />
        </Link>
      )}
      <details className="health-filter-panel">
        <summary>Change period & organisation</summary>
        <AnalysisFilterForm
          key={JSON.stringify(filters)}
          value={filters}
          directory={directory.data}
          onApply={apply}
        />
      </details>
      <FilterCaption filters={filters} directory={directory.data} />
      <p className="reports-footnote">
        Balances are as of <strong>{filters.to}</strong>. From / To selects repayment history. The
        7, 30 and 90 day outlook starts at the balance date.
      </p>
      {directory.error && (
        <p role="alert" className="reports-error">
          Organisation filters unavailable.{' '}
          <button onClick={directory.reload}>Retry filters</button>
        </p>
      )}
      {future || !validDate ? (
        <p role="alert" className="reports-error">
          Choose today or an earlier balance date. Upcoming payments are shown separately from
          actual balances.
        </p>
      ) : (
        <>
          <div className="health-status">
            <ShieldCheck size={20} />
            <div>
              <strong>Management view · partial coverage</strong>
              <p>
                Only your accessible companies and connected records are included. Figures are
                provisional until reconciled; this is not a consolidated balance sheet.
              </p>
            </div>
            <label>
              Currency
              <select
                aria-label="Group health currency"
                value={currency}
                onChange={(e) => apply({ currency: e.target.value })}
              >
                {[...new Set([currency, ...currencies])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="business-metrics health-metrics">
            {cards.map((c) => (
              <div key={c.label}>
                <span>{c.label}</span>
                {c.available ? (
                  <Link
                    href={href(c.target, {}, c.tab)}
                    onClick={
                      c.target === 'health'
                        ? (e) => {
                            e.preventDefault();
                            setSelected(c.tab);
                          }
                        : undefined
                    }
                  >
                    <strong>
                      {c.value === null
                        ? 'Needs reconciliation'
                        : c.value === undefined
                          ? 'No records'
                          : money(c.value, currency)}
                    </strong>
                    <ArrowUpRight size={16} />
                  </Link>
                ) : (
                  <strong className="health-unknown">Unavailable</strong>
                )}
                <small>{c.note}</small>
              </div>
            ))}
          </div>
          <div className="health-attention">
            <h2>
              <Activity size={18} /> Needs attention
            </h2>
            {alerts.length ? (
              <ul>
                {alerts.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : (
              <p>
                No alerts from the records loaded. Missing sources and unreconciled accounts still
                need review.
              </p>
            )}
            {inter && (
              <p>
                {money(inter.eliminated ?? '0', currency)} of matching intercompany principal is
                excluded from both receivables and payables in this scope.
              </p>
            )}
          </div>
          <div className="health-outlook">
            <h2>Payments ahead</h2>
            <p>
              Known supplier invoices, loan instalments and intercompany repayments. Each window
              includes overdue amounts; windows overlap and must not be added together.
            </p>
            <div>
              {[7, 30, 90].map((days) => (
                <article key={days}>
                  <span>Through {days} days</span>
                  <strong>
                    {purchases.data || loans.data || internal.data
                      ? money(decimal(dueThrough(due.rows, filters.to, days)), currency)
                      : 'Unavailable'}
                  </strong>
                  <small>Known commitments only</small>
                </article>
              ))}
            </div>
            <p>
              Customer invoice due dates are not guaranteed collection dates. Payroll, tax, future
              operating costs, unrecorded commitments and loans without schedules are not included.
            </p>
          </div>
          <nav className="analysis-tabs" aria-label="Group health detail views">
            {tables.map((t) => (
              <button
                key={t.id}
                aria-current={chosen.id === t.id ? 'page' : undefined}
                onClick={() => setSelected(t.id)}
              >
                {t.title}
              </button>
            ))}
          </nav>
          <AnalysisGrid
            companyId={filters.companyId || undefined}
            key={`${chosen.id}:${JSON.stringify(query)}:${currency}`}
            table={chosen}
            caption={`${currency} · As of ${filters.to}`}
            metadata={{
              Period: `${filters.from} to ${filters.to}`,
              Coverage: 'Accessible companies and connected sources only; provisional.',
              Basis: chosen.id.startsWith('internal')
                ? internal.data?.basis || ''
                : chosen.id === 'health-commitments'
                  ? 'Known obligations only; includes overdue amounts. Payroll, taxes, unrecorded costs and unscheduled loans are excluded.'
                  : loans.data?.basis || '',
              Scope:
                [filters.companyId, filters.divisionId, filters.branchId]
                  .filter(Boolean)
                  .join(' / ') || 'All accessible companies',
            }}
            rowLink={(r) =>
              r.kind === 'Supplier invoice'
                ? href('suppliers', {}, 'overdue')
                : String(r.href || '')
            }
          />
          <details className="health-coverage" open>
            <summary>Coverage & confidence</summary>
            <div>
              {sources.map((s) => (
                <article key={s.name}>
                  <strong>{s.name}</strong>
                  <span>
                    {!s.allowed
                      ? 'Access required'
                      : s.resource.loading
                        ? 'Loading…'
                        : s.resource.error
                          ? 'Unavailable'
                          : s.resource.data
                            ? 'Connected'
                            : 'Not loaded'}
                  </span>
                  {s.resource.error && (
                    <p role="alert">
                      {s.resource.error} <button onClick={s.resource.reload}>Retry</button>
                    </p>
                  )}
                  {s.resource.data && (
                    <small>Read {new Date(s.resource.data.generatedAt).toLocaleString()}</small>
                  )}
                </article>
              ))}
            </div>
            <ul>
              <li>
                ERP loans and Cash Desk accounts are separate records. Loan repayments are not
                posted again into Cash Desk by this report.
              </li>
              <li>
                Group-level borrowing is included only for group roles with no company, division or
                branch filter. Selecting a company shows its own obligations.
              </li>
              <li>
                Profit, inventory valuation, payroll, tax obligations and verified unrestricted cash
                are not yet consolidated here.
              </li>
              <li>
                Balances use current valid records and can change after corrections. Locked
                historical snapshots and a complete cash forecast are not yet available.
              </li>
            </ul>
            {loans.data && <p>{loans.data.basis}</p>}
            {internal.data && <p>{internal.data.basis}</p>}
          </details>
          <div className="health-actions">
            {hasPermission('loans.read') && (
              <Link href="/group-control/loans-debts">
                Manage borrowing <ArrowUpRight size={14} />
              </Link>
            )}
            {hasPermission('loan_schedules.list') && (
              <Link href="/accounting-engine/loan-repayments">
                Repayment schedules <ArrowUpRight size={14} />
              </Link>
            )}
            {canCash && (
              <Link href="/cash-desk">
                Open Cash Desk <ArrowUpRight size={14} />
              </Link>
            )}
          </div>
        </>
      )}
    </section>
  );
}
