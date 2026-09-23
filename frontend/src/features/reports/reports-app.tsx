'use client';
import { useEffect, useRef, useState } from 'react';
import { FormDateField } from '@/components/ui';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import {
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  CircleDollarSign,
  HandCoins,
  Landmark,
  LayoutGrid,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  ShoppingBag,
  Truck,
  Users,
  Wallet,
  Activity,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import { downloadTextFile } from '@/lib/report-export';
import { money, localToday, type Directory, type Scope } from '@/features/invoice-desk/types';
import { expenseCategories, movementLabels } from '@/features/cash-desk/types';
import { REPORTS, MORE_REPORTS, type ReportDefinition } from './report-definitions';
import {
  allReportRows,
  reportColumns,
  reportCsv,
  reportRows,
  type ReportResponse,
} from './report-data';
import './reports.css';
import { BusinessOverview, ReportAnalysis } from './report-analysis';
import { SavedReports } from './saved-reports';
import { GroupHealth } from './group-health';
import { AccountingReadiness } from './accounting-readiness';
import { AccountingDraftBoundary, AccountingDraftShelf } from './accounting-drafts';
import { printWorkspace } from '@/components/workspace/print-workspace';

const icons = {
  customers: Users,
  suppliers: Truck,
  sales: ShoppingBag,
  purchases: Receipt,
  expenses: CircleDollarSign,
  cash: Wallet,
  loans: HandCoins,
  health: Activity,
  accounting: Landmark,
};
export function ReportsApp() {
  return (
    <AccountingDraftBoundary shelf={false}>
      <ReportsWorkspace />
    </AccountingDraftBoundary>
  );
}
function ReportsWorkspace() {
  const { hasPermission, loading: authLoading, user } = useAuth();
  const router = useGuardedRouter();
  const params = useSearchParams(),
    view = params.get('view') ?? '';
  const report = REPORTS.find((r) => r.id === view);
  const available = REPORTS.filter((r) => hasPermission(r.permission));
  const [search, setSearch] = useState('');
  const cards = available.filter((r) =>
    `${r.name} ${r.description} ${r.source}`.toLowerCase().includes(search.toLowerCase()),
  );
  const healthAllowed = [
    'sales_desk.view',
    'invoice_desk.view',
    'cash_desk.view',
    'loans.read',
  ].some((permission) => hasPermission(permission));
  const nav = [
    { id: '', name: 'All reports' },
    ...(healthAllowed ? [{ id: 'health', name: 'Group Health' }] : []),
    ...(hasPermission('journal_entries.view')
      ? [{ id: 'accounting', name: 'Accounting readiness' }]
      : []),
    ...available,
  ];
  if (authLoading || !user) {
    return (
      <div className="reports-app">
        <p role="status" className="reports-empty">
          Loading
        </p>
      </div>
    );
  }
  return (
    <div className="reports-app">
      <aside className="reports-sidebar">
        <div className="reports-brand">
          <span>
            <BarChart3 size={23} />
          </span>
          <div>
            <strong>Reports</strong>
            <small>The bigger picture.</small>
          </div>
        </div>
        <nav aria-label="Report sections">
          {nav.map((r) => {
            const Icon = r.id ? icons[r.id as keyof typeof icons] : LayoutGrid;
            return (
              <Link
                key={r.id}
                href={r.id ? `/reports?view=${r.id}` : '/reports'}
                aria-current={view === r.id ? 'page' : undefined}
              >
                <Icon size={17} />
                {r.name}
              </Link>
            );
          })}
        </nav>
        <p className="reports-sidebar-note">
          One place to understand your business.
          <br />
          <br />
          Read directly from your apps, with your existing access.
        </p>
      </aside>
      <div className="reports-main">
        <label className="reports-mobile-nav">
          Report
          <select
            value={view}
            onChange={(e) =>
              router.push(e.target.value ? `/reports?view=${e.target.value}` : '/reports')
            }
          >
            {nav.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <SavedReports />
        <AccountingDraftShelf />
        {view === 'accounting' && hasPermission('journal_entries.view') ? (
          <AccountingReadiness />
        ) : view === 'health' && healthAllowed ? (
          <GroupHealth />
        ) : !view ? (
          <>
            <header className="reports-heading">
              <p className="reports-eyebrow">ITEMBA OS · REPORTS</p>
              <h1>A clearer view of your business.</h1>
              <p>See what is coming in, what is going out, and where things stand.</p>
            </header>
            {healthAllowed && (
              <Link href="/reports?view=health" className="health-entry">
                <div>
                  <strong>Group Health</strong>
                  <p>Cash, borrowing, intercompany balances and payments ahead.</p>
                </div>
                <ArrowUpRight size={22} />
              </Link>
            )}
            <BusinessOverview />
            <div className="reports-intro">
              <span>
                <BarChart3 size={25} />
              </span>
              <div>
                <strong>Start with a question.</strong>
                <p>
                  Choose a report, narrow it to your company or branch, then review or export the
                  results.
                </p>
              </div>
            </div>
            <div className="reports-section-heading">
              <h2>Everyday reports</h2>
              <label className="reports-search">
                <Search size={16} />
                <input
                  aria-label="Find a report"
                  placeholder="Find a report…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            <div className="reports-cards">
              {cards.map((r) => {
                const Icon = icons[r.id];
                return (
                  <Link className="reports-card" key={r.id} href={`/reports?view=${r.id}`}>
                    <span className={`reports-card-icon reports-icon-${r.id}`}>
                      <Icon size={23} strokeWidth={1.6} />
                    </span>
                    <span className="reports-card-source">{r.source}</span>
                    <h3>{r.name}</h3>
                    <p>{r.description}</p>
                    <span className="reports-card-open">
                      Open report <ChevronRight size={15} />
                    </span>
                  </Link>
                );
              })}
            </div>
            {!cards.length && (
              <p className="reports-empty">
                {available.length
                  ? 'No reports match your search.'
                  : 'Your role has no access to these app reports. Explore the report library or ask your administrator for access.'}
              </p>
            )}
            <div className="reports-section-heading">
              <h2>More ways to look at your business</h2>
            </div>
            <div className="reports-more">
              {MORE_REPORTS.filter((r) => hasPermission(r.permission)).map((r) => (
                <Link key={r.href} href={r.href}>
                  <Landmark size={18} />
                  <span>
                    <strong>{r.name}</strong>
                    <small>{r.description}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              ))}
            </div>
            <footer className="reports-library">
              <div>
                <strong>Looking for something specific?</strong>
                <p>The full report library includes specialist and statutory reports.</p>
              </div>
              <Link href="/reports/library">
                Browse library <ArrowUpRight size={15} />
              </Link>
            </footer>
          </>
        ) : report && hasPermission(report.permission) ? (
          report.id === 'loans' ? (
            <ReportView key={report.id} report={report} />
          ) : (
            <ReportAnalysis key={report.id} report={report} />
          )
        ) : (
          <div className="reports-empty">
            <h1>Report unavailable</h1>
            <p>This report does not exist or your role does not have access.</p>
            <Link href="/reports">Back to reports</Link>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportView({ report }: { report: ReportDefinition }) {
  const [scope, setScope] = useState<Scope>({ companyId: '', divisionId: '', branchId: '' });
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [search, setSearch] = useState('');
  const [status, setStatus] = useState('all'),
    [category, setCategory] = useState(''),
    [kind, setKind] = useState('');
  const [page, setPage] = useState(1),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState('');
  const exportController = useRef<AbortController | null>(null);
  const balance = report.mode === 'customers' || report.mode === 'suppliers';
  const trading = report.mode === 'sales' || report.mode === 'purchases';
  const dated = trading || report.mode === 'expenses';
  const invalid = dated && !!from && !!to && from > to;
  const query: Record<string, string | number> = Object.fromEntries(
    Object.entries(scope).filter(([, value]) => value),
  );
  if (dated) {
    if (from) query.from = from;
    if (to) query.to = to;
  }
  if (trading || report.mode === 'expenses') query.status = status;
  if (report.mode === 'expenses' && category) query.expenseCategory = category;
  if (report.mode === 'cash' && kind) query.kind = kind;
  if (!balance && report.mode !== 'loans' && search) query.search = search;
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    exportController.current?.abort();
    setExporting(false);
    setExportError('');
    return () => exportController.current?.abort();
  }, [queryKey, report.id]);
  const directory = useWorkspaceResource<Directory>(report.directory);
  const resource = useWorkspaceResource<ReportResponse>(report.path, { ...query, page }, !invalid);
  const summary = useWorkspaceResource<ReportResponse>(
    trading
      ? report.mode === 'sales'
        ? '/sales-desk/overview'
        : '/invoice-desk/overview'
      : report.path,
    query,
    trading && !invalid,
  );
  const rows = resource.data ? reportRows(report, resource.data) : [];
  const total = balance ? rows.length : (resource.data?.total ?? 0);
  const pageSize = resource.data?.pageSize ?? 25;
  const columns = reportColumns(report.mode);
  const totals = (trading ? summary.data : resource.data)?.currencies ?? [];
  const error = resource.error || (trading ? summary.error : '');
  const busy = resource.loading || (trading && summary.loading);
  function reload() {
    resource.reload();
    if (trading) summary.reload();
    directory.reload();
  }
  async function exportReport() {
    exportController.current?.abort();
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportError('');
    try {
      const all = await allReportRows(report, query, controller.signal);
      if (!controller.signal.aborted)
        downloadTextFile(
          `${report.id}-${from || 'all'}-${to || 'current'}.csv`,
          'text/csv;charset=utf-8',
          reportCsv(columns, all),
        );
    } catch (e) {
      if (!controller.signal.aborted)
        setExportError(e instanceof Error ? e.message : 'Export failed. Please try again.');
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  const dir = directory.data;
  return (
    <>
      <header className="reports-heading reports-report-heading">
        <div>
          <p className="reports-eyebrow">{report.source.toUpperCase()} · REPORTS</p>
          <h1>{report.name}</h1>
          <p>{report.description}</p>
        </div>
        <div className="reports-actions">
          <button onClick={reload} aria-label="Refresh report">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={(event) => printWorkspace(event.currentTarget)}
            disabled={busy || !!error || invalid}
          >
            <Printer size={16} />
            Print
          </button>
          <button
            className="reports-export"
            onClick={exportReport}
            disabled={busy || !!error || invalid || exporting || !total}
          >
            <ArrowDownToLine size={16} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </header>
      <section className="reports-filters" aria-label="Report filters">
        {(['companyId', 'divisionId', 'branchId'] as const).map((key, i) => {
          const list =
            i === 0
              ? dir?.companies
              : i === 1
                ? dir?.divisions.filter((d) => !scope.companyId || d.companyId === scope.companyId)
                : dir?.branches.filter(
                    (b) =>
                      (!scope.companyId || b.companyId === scope.companyId) &&
                      (!scope.divisionId || b.divisionId === scope.divisionId),
                  );
          return (
            <label key={key}>
              {['Company', 'Division', 'Branch'][i]}
              <select
                value={scope[key]}
                disabled={directory.loading || !!directory.error}
                onChange={(e) => {
                  setScope((s) => ({
                    ...s,
                    [key]: e.target.value,
                    ...(i === 0
                      ? { divisionId: '', branchId: '' }
                      : i === 1
                        ? { branchId: '' }
                        : {}),
                  }));
                  setPage(1);
                }}
              >
                <option value="">All accessible {['companies', 'divisions', 'branches'][i]}</option>
                {list?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        {dated && (
          <>
            <div className="ui-date-caption">
              From
              <FormDateField
                aria-label="From"
                value={from}
                onChange={(value) => {
                  setFrom(value);
                  setPage(1);
                }}
                className="ui-date-field-inline"
              />
            </div>
            <div className="ui-date-caption">
              To
              <FormDateField
                aria-label="To"
                value={to}
                onChange={(value) => {
                  setTo(value);
                  setPage(1);
                }}
                className="ui-date-field-inline"
              />
            </div>
          </>
        )}
        {(trading || report.mode === 'expenses') && (
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {(trading
                ? ['all', 'unpaid', 'partial', 'paid', 'overdue', 'void']
                : ['all', 'paid', 'reversed']
              ).map((s) => (
                <option key={s} value={s}>
                  {
                    (
                      {
                        all: 'All statuses',
                        partial: 'Partially paid',
                        void: 'Voided',
                        paid: 'Paid',
                        unpaid: 'Unpaid',
                        overdue: 'Overdue',
                        reversed: 'Reversed',
                      } as Record<string, string>
                    )[s]
                  }
                </option>
              ))}
            </select>
          </label>
        )}
        {report.mode === 'expenses' && (
          <label>
            Category
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {Object.entries({ ...expenseCategories, UNCATEGORIZED: 'Uncategorised' }).map(
                ([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
        {report.mode === 'cash' && (
          <label>
            Movement type
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All movements</option>
              {Object.entries(movementLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
        {!balance && report.mode !== 'loans' && (
          <label>
            Search
            <input
              type="search"
              maxLength={100}
              placeholder="Name, reference or description"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
        )}
      </section>
      {dated && (
        <div className="reports-date-shortcuts" aria-label="Date shortcuts">
          <button
            onClick={() => {
              const today = localToday();
              setFrom(`${today.slice(0, 7)}-01`);
              setTo(today);
              setPage(1);
            }}
          >
            This month
          </button>
          <button
            onClick={() => {
              const today = localToday();
              setFrom(`${today.slice(0, 4)}-01-01`);
              setTo(today);
              setPage(1);
            }}
          >
            This year
          </button>
          <button
            onClick={() => {
              setFrom('');
              setTo('');
              setPage(1);
            }}
          >
            All dates
          </button>
        </div>
      )}
      <p className="reports-scope-summary">
        {dir?.companies.find((c) => c.id === scope.companyId)?.name ?? 'All accessible companies'}
        {' · '}
        {dir?.divisions.find((d) => d.id === scope.divisionId)?.name ?? 'All accessible divisions'}
        {' · '}
        {dir?.branches.find((b) => b.id === scope.branchId)?.name ?? 'All accessible branches'}
        {dated && (
          <>
            {' '}
            · {from || 'Beginning'} to {to || 'Latest'}
          </>
        )}
        {(trading || report.mode === 'expenses') && <> · Status: {status}</>}
        {category && <> · {expenseCategories[category] ?? 'Uncategorised'}</>}
        {kind && <> · {movementLabels[kind]}</>}
        {search && <> · Search: {search}</>}
      </p>
      <p className="reports-context">
        {balance
          ? 'Current unpaid balances across all dates. Fully paid and voided invoices are excluded.'
          : trading
            ? 'Dates filter the original sale or invoice. Paid amounts and balances reflect payments recorded to date. Summary totals exclude voided records.'
            : report.mode === 'expenses'
              ? 'Dates filter the expense date. Paid totals exclude reversed expenses; category totals cover all matching records.'
              : report.mode === 'cash'
                ? 'All dates. Each movement appears once; account entries show its direction. Reversals are retained for the audit trail.'
                : 'All dates. Loans include both lending and borrowing accounts within your accessible scope.'}{' '}
        Amounts remain separate by currency.
      </p>
      {directory.error && (
        <p role="alert" className="reports-error">
          Organisation filters could not load.{' '}
          <button onClick={directory.reload}>Retry filters</button>
        </p>
      )}
      {invalid ? (
        <p role="alert" className="reports-error">
          The start date must be on or before the end date.
        </p>
      ) : error ? (
        <div role="alert" className="reports-error">
          {error} <button onClick={reload}>Try again</button>
        </div>
      ) : busy ? (
        <p role="status" className="reports-empty">
          Loading report…
        </p>
      ) : (
        <>
          {!!totals.length && (
            <section className="reports-totals" aria-label="Report totals">
              {totals.map((t) => (
                <div className="reports-total" key={t.currency}>
                  <strong>{t.currency}</strong>
                  <dl>
                    {(report.mode === 'expenses'
                      ? [
                          ['Paid expenses', t.paid],
                          ['Reversed expenses', t.reversed],
                        ]
                      : balance
                        ? [
                            [
                              report.mode === 'customers' ? 'Customers owe' : 'You owe suppliers',
                              t.outstanding,
                            ],
                            ['Overdue', t.overdue],
                          ]
                        : [
                            ['Total amount', t.total],
                            ['Paid to date', t.paid],
                            ['Outstanding', t.outstanding],
                            ['Overdue', t.overdue],
                          ]
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{money(value ?? '0')}</dd>
                      </div>
                    ))}
                  </dl>
                  {t.categories && (
                    <div className="reports-categories">
                      {Object.entries(t.categories).map(([key, value]) => (
                        <span key={key}>
                          {expenseCategories[key] ?? 'Uncategorised'} <b>{money(value)}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
          <div className="reports-table-heading">
            <h2>{balance ? 'Open balances' : 'Report details'}</h2>
            <span>
              {total.toLocaleString()} {balance ? 'balances' : 'records'} ·{' '}
              {balance
                ? 'All results'
                : `Page ${page} of ${Math.max(1, Math.ceil(total / pageSize))}`}
            </span>
          </div>
          {!rows.length ? (
            <div className="reports-empty">
              <BarChart3 size={30} />
              <h3>No matching records</h3>
              <p>
                Try a wider scope or date range. Records will appear here when they are added in{' '}
                {report.source}.
              </p>
            </div>
          ) : (
            <div
              className="reports-table-wrap"
              role="region"
              aria-label={`${report.name} results`}
              tabIndex={0}
            >
              <table>
                <caption className="sr-only">
                  {report.name} — {report.source}
                </caption>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.title} scope="col" className={c.numeric ? 'reports-number' : ''}>
                        {c.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={`${row.id}-${row.currency}-${i}`}>
                      {columns.map((c) => (
                        <td key={c.title} className={c.numeric ? 'reports-number' : ''}>
                          {c.numeric && c.title !== 'Open invoices'
                            ? money(c.value(row))
                            : c.value(row) || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!balance && total > pageSize && (
            <nav className="reports-pagination" aria-label="Report pages">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>Page {page}</span>
              <button disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </nav>
          )}
          <p className="reports-footnote">
            CSV exports every matching row, up to 10,000. Print includes the displayed page and
            summary. Source: {report.source}.
          </p>
        </>
      )}
      {exportError && (
        <p role="alert" className="reports-error">
          {exportError}
        </p>
      )}
    </>
  );
}
