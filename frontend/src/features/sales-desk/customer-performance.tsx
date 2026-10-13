'use client';

import { useEffect, useEffectEvent } from 'react';
import { ArrowLeft, ArrowUpRight, RefreshCw, Users } from 'lucide-react';
import {
  Btn,
  FormDateField,
  PermissionDeniedState,
  StatusBadge,
  WorkspaceTable,
} from '@/components/ui';
import {
  WorkspaceLink,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { useLinkedDeskChanges } from '@/components/workspace/linked-desk-changes';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useAuth } from '@/hooks/use-auth';
import { performanceDate, performanceDates, performanceToday } from './customer-performance-dates';
import {
  performanceCategories,
  performanceMoney,
  paymentLabels,
  paymentSourceLabel,
  performanceDefaultDates,
  type CustomerPerformance,
  type CustomerPerformanceRow,
  type CustomerPaymentHistory,
  type PerformanceCategory,
  type PerformanceFilters,
} from './customer-performance-types';
import {
  CustomerStatementWorkspace,
  type SavedCustomerStatement,
} from './customer-statement-workspace';
import './customer-performance.css';

type Choice = { id: string; name: string };
const PAGE_SIZE = 25;
const filterNames: (keyof PerformanceFilters)[] = [
  'companyId',
  'divisionId',
  'branchId',
  'currency',
  'dateFrom',
  'dateTo',
  'search',
  'category',
  'sort',
];
function filtersFrom(params: URLSearchParams, companyId = ''): PerformanceFilters {
  const values: PerformanceFilters = {
    companyId,
    divisionId: '',
    branchId: '',
    currency: 'TZS',
    ...performanceDefaultDates(),
    search: '',
    category: '',
    sort: 'net-sales',
  };
  for (const field of filterNames) if (params.has(field)) values[field] = params.get(field) ?? '';
  return values;
}
function Category({ row }: { row: CustomerPerformanceRow }) {
  return (
    <span className={`customer-performance-category customer-performance-category-${row.category}`}>
      {performanceCategories[row.category]}
    </span>
  );
}
function Pagination({
  page,
  total,
  limit,
  onChange,
  label,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
  label: string;
}) {
  return (
    <nav className="customer-performance-pagination" aria-label={label}>
      <Btn variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Btn>
      <span>
        Page {page} of {Math.max(1, Math.ceil(total / limit))} · {total}{' '}
        {label === 'Payment pages' ? 'payments' : 'customers'}
      </span>
      <Btn variant="secondary" disabled={page * limit >= total} onClick={() => onChange(page + 1)}>
        Next
      </Btn>
    </nav>
  );
}

export function CustomerPerformancePage() {
  const { user, hasPermission, loading: authLoading } = useAuth();
  const params = useWorkspaceSearchParams();
  const queryText = params.toString();
  const customerId = params.get('customerId') ?? '';
  const canView = !authLoading && hasPermission('customers.view') && hasPermission('sales.view');
  const [filters, setFilters] = useWorkspaceState<PerformanceFilters>(
    'sales-desk.customer-performance.filters',
    () => filtersFrom(params, user?.companyId ?? ''),
  );
  const [page, setPage] = useWorkspaceState('sales-desk.customer-performance.page', 1);
  const applyRequestedFilters = useEffectEvent((query: string) => {
    const requested = new URLSearchParams(query);
    if (!filterNames.some((key) => requested.has(key))) return;
    const next = filtersFrom(requested, user?.companyId ?? '');
    if (filterNames.every((name) => next[name] === filters[name])) return;
    setFilters(next);
    setPage(1);
  });
  useEffect(() => applyRequestedFilters(queryText), [queryText]);
  const companies = useWorkspaceChoices<Choice>(
    '/companies',
    {},
    canView && hasPermission('companies.read'),
  );
  const divisions = useWorkspaceChoices<Choice>(
    '/divisions',
    { companyId: filters.companyId },
    canView && !!filters.companyId && hasPermission('divisions.read'),
  );
  const branches = useWorkspaceChoices<Choice>(
    '/branches',
    { companyId: filters.companyId, divisionId: filters.divisionId, activeOnly: true },
    canView && !!filters.companyId && hasPermission('branches.read'),
  );
  const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
  const validDates =
    !!filters.dateFrom &&
    !!filters.dateTo &&
    filters.dateFrom <= filters.dateTo &&
    filters.dateTo <= performanceToday();
  const resource = useWorkspaceResource<CustomerPerformance>(
    '/customer-performance',
    { ...query, page, limit: PAGE_SIZE },
    canView && validDates && !customerId,
  );
  useLinkedDeskChanges('sales-desk', false, resource.reload);
  const data = resource.data;
  const update = (values: Partial<PerformanceFilters>) => {
    setFilters((current) => ({ ...current, ...values }));
    setPage(1);
  };
  const href = (id?: string) =>
    `/sales-desk/customer-performance?${new URLSearchParams({ ...query, ...(id ? { customerId: id } : {}) })}`;
  const choiceErrors = [companies, divisions, branches].filter((choices) => choices.error);
  if (authLoading) return <p role="status">Opening Customer Performance…</p>;
  if (!canView)
    return (
      <PermissionDeniedState description="Customer and sales viewing access are required to compare customer performance." />
    );
  return (
    <div className="customer-performance">
      <header className="customer-performance-heading">
        <div>
          <p className="customer-performance-eyebrow">SALES DESK / CUSTOMER ACCOUNTS</p>
          <h1>Customer Performance</h1>
          <p>Understand who buys, who pays reliably, and who needs attention.</p>
        </div>
        {!customerId && (
          <Btn variant="secondary" onClick={resource.reload} disabled={resource.loading}>
            <RefreshCw size={16} />
            Refresh
          </Btn>
        )}
      </header>
      <section className="customer-performance-filter-panel" aria-label="Performance filters">
        <div className="customer-performance-presets">
          <button type="button" onClick={() => update(performanceDefaultDates())}>
            Last 90 days
          </button>
          {[
            ['This month', 'month'],
            ['This week', 'week'],
            ['Today', 'today'],
          ].map(([label, preset]) => (
            <button type="button" key={preset} onClick={() => update(performanceDates(preset))}>
              {label}
            </button>
          ))}
        </div>
        <div className="customer-performance-filters">
          <label>
            Company
            <select
              value={filters.companyId}
              onChange={(event) =>
                update({ companyId: event.target.value, divisionId: '', branchId: '' })
              }
            >
              <option value="">All permitted companies</option>
              {!companies.rows.length && user?.companyId && (
                <option value={user.companyId}>Your company</option>
              )}
              {companies.rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Division
            <select
              disabled={!filters.companyId}
              value={filters.divisionId}
              onChange={(event) => update({ divisionId: event.target.value, branchId: '' })}
            >
              <option value="">All permitted divisions</option>
              {divisions.rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <select
              disabled={!filters.companyId}
              value={filters.branchId}
              onChange={(event) => update({ branchId: event.target.value })}
            >
              <option value="">All permitted branches</option>
              {branches.rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Currency
            <select
              value={filters.currency}
              onChange={(event) => update({ currency: event.target.value })}
            >
              {['TZS', 'USD', 'EUR', 'KES', 'GBP', 'UGX'].map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </label>
          <FormDateField
            label="Performance from"
            value={filters.dateFrom}
            max={filters.dateTo}
            onChange={(dateFrom) => update({ dateFrom })}
            required
          />
          <FormDateField
            label="Performance to"
            value={filters.dateTo}
            min={filters.dateFrom}
            max={performanceToday()}
            onChange={(dateTo) => update({ dateTo })}
            required
          />
          {!customerId && (
            <>
              <label className="customer-performance-search">
                Search customers
                <input
                  type="search"
                  placeholder="Name or customer code"
                  value={filters.search}
                  onChange={(event) => update({ search: event.target.value })}
                />
              </label>
              <label>
                Performance group
                <select
                  value={filters.category}
                  onChange={(event) => update({ category: event.target.value })}
                >
                  <option value="">All groups</option>
                  {Object.entries(performanceCategories).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sort customers
                <select
                  value={filters.sort}
                  onChange={(event) => update({ sort: event.target.value })}
                >
                  <option value="net-sales">Highest net sales</option>
                  <option value="collected">Most collected</option>
                  <option value="overdue">Most overdue</option>
                  <option value="name">Customer name</option>
                </select>
              </label>
            </>
          )}
        </div>
        {choiceErrors.map((choices, index) => (
          <p role="alert" className="customer-performance-error" key={index}>
            {choices.error}{' '}
            <Btn variant="secondary" onClick={choices.retry}>
              Retry choices
            </Btn>
          </p>
        ))}
        {!validDates && (
          <p role="alert" className="customer-performance-error">
            Choose a valid period ending today or earlier.
          </p>
        )}
      </section>
      {customerId ? (
        <CustomerPerformanceFocus
          key={customerId}
          customerId={customerId}
          filters={filters}
          validDates={validDates}
          backHref={href()}
        />
      ) : (
        <>
          {resource.loading && (
            <p role="status" className="customer-performance-note">
              Loading customer performance…
            </p>
          )}
          {resource.error && (
            <div role="alert" className="customer-performance-error">
              {resource.error}{' '}
              <Btn variant="secondary" onClick={resource.reload}>
                Retry performance
              </Btn>
            </div>
          )}
          {data && (
            <>
              <p className="customer-performance-note">
                Activity: {performanceDate(data.period.dateFrom, true)} –{' '}
                {performanceDate(data.period.dateTo, true)}. Payment reliability is assessed through{' '}
                {performanceDate(data.reliabilityAsOf, true)}. Account exposure is current as of{' '}
                {performanceDate(data.asOf, true)}.
              </p>
              <p className="customer-performance-note">
                Net sales: {data.rules.salesBasis}. Rankings use the full permitted organisation and
                currency scope.
              </p>
              {data.warnings?.map((warning) => (
                <p key={warning} className="customer-performance-note">
                  {warning}
                </p>
              ))}
              <section
                className="customer-performance-groups"
                aria-label="Customer performance groups"
              >
                {data.receiptBasis === 'scoped-settlements' && (
                  <p className="customer-performance-note customer-performance-group-note">
                    Scoped collections are authorised receipt and settlement amounts; some
                    allocations represent cash received elsewhere.
                  </p>
                )}
                {(
                  [
                    'best',
                    'good',
                    'needs-attention',
                    'insufficient-history',
                    'inactive',
                  ] as PerformanceCategory[]
                ).map((category) => {
                  const count =
                    data.summary[
                      (
                        {
                          best: 'best',
                          good: 'good',
                          'needs-attention': 'needsAttention',
                          'insufficient-history': 'insufficientHistory',
                          inactive: 'inactive',
                        } as const
                      )[category]
                    ];
                  return (
                    <button
                      type="button"
                      key={category}
                      aria-pressed={filters.category === category}
                      onClick={() =>
                        update({ category: filters.category === category ? '' : category })
                      }
                    >
                      <span>{performanceCategories[category]}</span>
                      <strong>{count}</strong>
                    </button>
                  );
                })}
              </section>
              <div className="customer-performance-metrics">
                {[
                  ['Net sales in period', data.summary.netSales],
                  [
                    data.receiptBasis === 'scoped-settlements'
                      ? 'Scoped collections in period'
                      : 'Collected in period',
                    data.summary.collected,
                  ],
                  ['Outstanding now', data.summary.outstanding],
                  ['Overdue now', data.summary.overdue],
                ].map(([label, amount]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{performanceMoney(amount, data.currency)}</strong>
                  </div>
                ))}
              </div>
              {!data.access.balances && (
                <p className="customer-performance-note">
                  Receivables access is required to view balances. Restricted figures are
                  unavailable.
                </p>
              )}
              {!data.access.receipts && (
                <p className="customer-performance-note">
                  Cash Desk, receivables and customer payment access are required to assess payment
                  reliability.
                </p>
              )}
              <details className="customer-performance-explainer">
                <summary>How customers are assessed</summary>
                <p>
                  Sales contribution and payment reliability are assessed separately. Best customers
                  are in the top {data.rules.topSalesPercent}% by sales with at least{' '}
                  {data.rules.bestOnTimePercent}% paid on time and no overdue invoices. Good
                  customers meet the {data.rules.goodOnTimePercent}% on-time threshold. At least{' '}
                  {data.rules.minimumDueInvoices} due invoices are required to establish credit
                  history. Overdue exposure can require attention even when sales are high.
                  Cash-only activity does not establish a credit payment record.
                </p>
              </details>
              <section className="customer-performance-register" aria-label="Customer rankings">
                <div className="customer-performance-heading">
                  <h2>
                    Customers <span className="customer-performance-count">{data.total}</span>
                  </h2>
                  <span>Sales contribution and payment reliability</span>
                </div>
                {!data.rows.length ? (
                  <div className="customer-performance-empty">
                    <Users size={28} />
                    <h3>No customers match these filters</h3>
                    <p>Try another period or performance group.</p>
                  </div>
                ) : (
                  <WorkspaceTable label="Customer performance table">
                    <caption className="sr-only">Customer performance in {data.currency}</caption>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Assessment</th>
                        <th className="customer-performance-number">Net sales</th>
                        <th className="customer-performance-number">
                          {data.receiptBasis === 'scoped-settlements'
                            ? 'Scoped collections'
                            : 'Collected'}
                        </th>
                        <th className="customer-performance-number">Outstanding / overdue</th>
                        <th>Payment record</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <WorkspaceLink href={href(row.id)}>{row.name}</WorkspaceLink>
                            <small>{row.code ?? 'No customer code'}</small>
                          </td>
                          <td>
                            <Category row={row} />
                            <small>{row.reasons.join(' · ')}</small>
                          </td>
                          <td className="customer-performance-number">
                            <strong>{performanceMoney(row.netSales, data.currency)}</strong>
                            <small>
                              {row.salesCount} sales
                              {row.salesRank ? ` · Rank ${row.salesRank}` : ''}
                            </small>
                          </td>
                          <td className="customer-performance-number">
                            {performanceMoney(row.collected, data.currency)}
                          </td>
                          <td className="customer-performance-number">
                            {performanceMoney(row.outstanding, data.currency)}
                            <small>Overdue: {performanceMoney(row.overdue, data.currency)}</small>
                          </td>
                          <td>
                            <span>{paymentLabels[row.paymentLabel]}</span>
                            <small>
                              {row.onTimePercent == null
                                ? 'On-time record unavailable'
                                : `${row.onTimePercent}% paid on time · ${row.eligibleInvoiceCount} due invoices`}
                            </small>
                            <small>
                              {row.lastPaymentDate
                                ? `Last payment ${performanceDate(row.lastPaymentDate)}`
                                : 'No verified payment date'}
                            </small>
                          </td>
                          <td>
                            <WorkspaceLink
                              href={href(row.id)}
                              aria-label={`View performance for ${row.name}`}
                              className="customer-performance-text-link"
                            >
                              View <ArrowUpRight size={14} />
                            </WorkspaceLink>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </WorkspaceTable>
                )}
                <Pagination
                  page={page}
                  total={data.total}
                  limit={data.limit}
                  onChange={setPage}
                  label="Customer pages"
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CustomerPerformanceFocus({
  customerId,
  filters,
  validDates,
  backHref,
}: {
  customerId: string;
  filters: PerformanceFilters;
  validDates: boolean;
  backHref: string;
}) {
  const { hasPermission } = useAuth();
  const [page, setPage] = useWorkspaceState(
    `sales-desk.customer-performance.historyPage.${customerId}`,
    1,
  );
  const scope = Object.fromEntries(
    Object.entries(filters).filter(
      ([key, value]) =>
        value &&
        ['companyId', 'divisionId', 'branchId', 'currency', 'dateFrom', 'dateTo'].includes(key),
    ),
  );
  const scopeKey = JSON.stringify(scope);
  const resetHistoryPage = useEffectEvent(() => setPage(1));
  useEffect(() => resetHistoryPage(), [scopeKey]);
  const history = useWorkspaceResource<CustomerPaymentHistory>(
    `/customer-performance/${encodeURIComponent(customerId)}/history`,
    { ...scope, page, limit: PAGE_SIZE },
    validDates,
  );
  const data = history.data;
  const saved = useWorkspaceResource<{ data: SavedCustomerStatement[] }>(
    '/customer-statements',
    { companyId: data?.customer.companyId ?? '', customerId, page: 1, limit: 20 },
    !!data && hasPermission('customer_statements.list'),
  );
  useLinkedDeskChanges('sales-desk', false, history.reload);
  return (
    <section className="customer-performance-focus" aria-label="Customer account detail">
      <WorkspaceLink href={backHref} className="customer-performance-text-link">
        <ArrowLeft size={16} />
        Back to customer performance
      </WorkspaceLink>
      {history.loading && <p role="status">Loading customer account…</p>}
      {history.error && (
        <div role="alert" className="customer-performance-error">
          {history.error}{' '}
          <Btn variant="secondary" onClick={history.reload}>
            Retry customer account
          </Btn>
        </div>
      )}
      {data && (
        <>
          <header className="customer-performance-heading">
            <div>
              <h2>{data.customer.name}</h2>
              <p>
                {data.customer.code ?? 'No customer code'} · {data.currency}
              </p>
            </div>
            <div className="customer-performance-actions">
              <WorkspaceLink href={`/sales-desk/customers/${encodeURIComponent(customerId)}`}>
                Open customer profile
              </WorkspaceLink>
              <Btn variant="secondary" onClick={history.reload}>
                Refresh account
              </Btn>
            </div>
          </header>
          {data.warnings?.map((warning) => (
            <p key={warning} className="customer-performance-note">
              {warning}
            </p>
          ))}
          <section
            className="customer-performance-assessment"
            aria-label="Why this customer rating"
          >
            <Category row={data.performance} />
            <h3>Why this rating</h3>
            <ul>
              {data.performance.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p>
              {paymentLabels[data.performance.paymentLabel]}
              {data.performance.eligibleInvoiceCount == null
                ? ''
                : ` · ${data.performance.eligibleInvoiceCount} eligible due invoices`}
              {data.performance.missingDueDateCount
                ? ` · ${data.performance.missingDueDateCount} invoices missing due dates`
                : ''}
            </p>
          </section>
          <p className="customer-performance-note">
            Activity: {performanceDate(data.period.dateFrom, true)} –{' '}
            {performanceDate(data.period.dateTo, true)}. Payment reliability is assessed through{' '}
            {performanceDate(data.reliabilityAsOf, true)}. Balances below are current as of{' '}
            {performanceDate(data.asOf, true)}. Net sales include tax, after credit adjustments.
          </p>
          <div className="customer-performance-metrics">
            {[
              ['Net sales in period', data.performance.netSales],
              [
                data.performance.receiptBasis === 'scoped-settlements'
                  ? 'Scoped collections in period'
                  : 'Collected in period',
                data.performance.collected,
              ],
              ['Open invoices now', data.performance.outstanding],
              ['Overdue now', data.performance.overdue],
            ].map(([label, amount]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{performanceMoney(amount, data.currency)}</strong>
              </div>
            ))}
          </div>
          <dl className="customer-performance-account-totals">
            <div>
              <dt>Customer credit / deposits now</dt>
              <dd>{performanceMoney(data.performance.customerCredit, data.currency)}</dd>
            </div>
            <div>
              <dt>Net amount due now</dt>
              <dd>{performanceMoney(data.performance.netDue, data.currency)}</dd>
            </div>
            <div>
              <dt>Oldest overdue invoice</dt>
              <dd>
                {data.performance.oldestDaysOverdue == null
                  ? 'Unavailable'
                  : `${data.performance.oldestDaysOverdue} days`}
              </dd>
            </div>
          </dl>
          <section className="customer-performance-register" aria-label="Customer payment history">
            <div className="customer-performance-heading">
              <h3>Payment history</h3>
              <span>
                {data.performance.receiptBasis === 'scoped-settlements'
                  ? 'Receipts and scoped settlements or reversals in the selected period'
                  : 'Receipts or reversals in the selected period'}
              </span>
            </div>
            {data.performance.receiptBasis === 'scoped-settlements' && (
              <p className="customer-performance-note">
                Authorised receipt and settlement amounts; some allocations represent cash received
                elsewhere. Allocation dates show when an invoice was settled.
              </p>
            )}
            {!data.access.receipts ? (
              <p className="customer-performance-note">
                Cash Desk, receivables and customer payment access are required to view payment
                history.
              </p>
            ) : !data.rows.length ? (
              <p className="customer-performance-note">No payment records in this period.</p>
            ) : (
              <WorkspaceTable label="Customer payment records">
                <caption className="sr-only">
                  Payments for {data.customer.name} in {data.currency}
                </caption>
                <thead>
                  <tr>
                    <th>Date / receipt</th>
                    <th>Source / method</th>
                    <th className="customer-performance-number">
                      {data.performance.receiptBasis === 'scoped-settlements'
                        ? 'Receipt / settlement amount'
                        : 'Received'}
                    </th>
                    <th className="customer-performance-number">Applied / credit</th>
                    <th>Status / details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        {performanceDate(payment.date)}
                        <small>
                          {payment.sourceUrl ? (
                            <WorkspaceLink href={payment.sourceUrl}>
                              {payment.reference}
                            </WorkspaceLink>
                          ) : (
                            payment.reference
                          )}
                        </small>
                      </td>
                      <td>
                        {paymentSourceLabel(payment.source)}
                        <small>
                          {payment.method?.replaceAll('_', ' ') ?? 'Method not recorded'}
                        </small>
                      </td>
                      <td className="customer-performance-number">
                        {performanceMoney(payment.amount, data.currency)}
                        {payment.reversalAmount && (
                          <small>
                            Reversal: {performanceMoney(payment.reversalAmount, data.currency)}
                          </small>
                        )}
                      </td>
                      <td className="customer-performance-number">
                        {performanceMoney(payment.appliedAmount, data.currency)}
                        <small>
                          Unapplied: {performanceMoney(payment.unappliedAmount, data.currency)}
                        </small>
                      </td>
                      <td>
                        <StatusBadge status={payment.status} />
                        {payment.reversedAt && (
                          <small>
                            Reversed {performanceDate(payment.reversedAt)}
                            {payment.reversalReason ? ` · ${payment.reversalReason}` : ''}
                          </small>
                        )}
                        <details className="customer-performance-payment-details">
                          <summary>Payment allocations</summary>
                          {payment.allocations.length ? (
                            <ul>
                              {payment.allocations.map((allocation, index) => (
                                <li key={`${allocation.reference}-${index}`}>
                                  {allocation.receivableId ? (
                                    <WorkspaceLink
                                      href={`/finance/receivables?customerId=${encodeURIComponent(customerId)}&companyId=${encodeURIComponent(data.customer.companyId)}&search=${encodeURIComponent(allocation.reference)}`}
                                    >
                                      {allocation.reference}
                                    </WorkspaceLink>
                                  ) : (
                                    allocation.reference
                                  )}{' '}
                                  · {performanceMoney(allocation.amount, data.currency)}
                                  {allocation.date
                                    ? ` · Settled ${performanceDate(allocation.date)}`
                                    : ''}
                                  {allocation.dueDate
                                    ? ` · Due ${performanceDate(allocation.dueDate)}`
                                    : ' · No due date'}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>No invoice allocations.</p>
                          )}
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WorkspaceTable>
            )}
            {data.access.receipts && (
              <Pagination
                page={page}
                total={data.total}
                limit={data.limit}
                onChange={setPage}
                label="Payment pages"
              />
            )}
          </section>
          <CustomerStatementWorkspace
            key={`${customerId}:${scopeKey}`}
            customer={data.customer}
            initialSelection={{
              companyId: data.customer.companyId,
              customerId,
              currency: filters.currency,
              dateFrom: filters.dateFrom,
              dateTo: filters.dateTo,
              ...(filters.divisionId ? { divisionId: filters.divisionId } : {}),
              ...(filters.branchId ? { branchId: filters.branchId } : {}),
            }}
            savedRuns={saved.data?.data}
            onSaved={saved.reload}
          />
          {saved.error && (
            <p role="alert" className="customer-performance-error">
              Saved statements: {saved.error}{' '}
              <Btn variant="secondary" onClick={saved.reload}>
                Retry saved statements
              </Btn>
            </p>
          )}
          <p className="customer-performance-note">
            Business sales and receipts use shared customer records. Older Direct entries remain in
            the customer profile’s separate Direct history section.
          </p>
        </>
      )}
    </section>
  );
}
