'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowRight, Clock3, Plus, RefreshCw, TrendingUp, Users, Wallet } from 'lucide-react';
import { Btn } from '@/components/ui';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useLinkedDeskChanges, notifyDeskSaved } from '@/components/workspace/linked-desk-changes';
import { TradingPartnerEditor } from '@/components/workspace/trading-partner-editor';
import {
  OverviewAmounts,
  OverviewLink as Link,
  OverviewCollectionsTable,
  OverviewPanel,
  OverviewRankingList,
  OverviewTrend,
} from './sales-overview-panels';
import {
  overviewChange,
  overviewDate,
  overviewDates,
  overviewMoney,
  overviewToday,
  type SalesOverview,
} from './sales-overview-types';
import './sales-overview.css';

const NewSale = dynamic(() => import('./business-sales').then((module) => module.SalesOrderModal));
type Choice = { id: string; name: string; code?: string };
type Filters = {
  companyId: string;
  divisionId: string;
  branchId: string;
  currency: string;
  dateFrom: string;
  dateTo: string;
  preset: string;
};

export function SalesDeskOverview() {
  const { user, hasPermission } = useAuth();
  const canSales = hasPermission('sales.view'),
    canCustomers = hasPermission('customers.view');
  const canCollections =
    canSales && hasPermission('cash_desk.view') && hasPermission('receivables.view');
  const [filters, setFilters] = useWorkspaceState<Filters>('sales-desk.overview.filters', () => ({
    companyId: user?.companyId ?? '',
    divisionId: '',
    branchId: '',
    currency: 'TZS',
    ...overviewDates('month'),
    preset: 'month',
  }));
  const [creatingSale, setCreatingSale] = useState(false),
    [creatingCustomer, setCreatingCustomer] = useState(false);
  const companies = useWorkspaceChoices<Choice>('/companies', {}, hasPermission('companies.read'));
  const divisions = useWorkspaceChoices<Choice>(
    '/divisions',
    { companyId: filters.companyId },
    !!filters.companyId && hasPermission('divisions.read'),
  );
  const branches = useWorkspaceChoices<Choice>(
    '/branches',
    { companyId: filters.companyId, divisionId: filters.divisionId, activeOnly: true },
    !!filters.divisionId && hasPermission('branches.read'),
  );
  const query = Object.fromEntries(
    Object.entries(filters).filter(([key, value]) => key !== 'preset' && value),
  );
  const validDates =
    !!filters.dateFrom &&
    !!filters.dateTo &&
    filters.dateFrom <= filters.dateTo &&
    filters.dateTo <= overviewToday();
  const resource = useWorkspaceResource<SalesOverview>(
    '/sales-orders/overview',
    query,
    canSales && validDates,
  );
  const customers = useWorkspaceResource<{ total: number; active: number; blocked: number }>(
    '/customers/workbench-summary',
    filters.companyId ? { companyId: filters.companyId } : {},
    canCustomers && !canSales,
  );
  const refresh = () => {
    resource.reload();
    customers.reload();
  };
  useLinkedDeskChanges('sales-desk', creatingSale || creatingCustomer, refresh);
  const data = resource.data;
  const scopeQuery = Object.fromEntries(
    Object.entries(filters).filter(
      ([key, value]) => ['companyId', 'divisionId', 'branchId', 'currency'].includes(key) && value,
    ),
  );
  const salesHref = (extra: Record<string, string> = {}) =>
    `/sales-desk/sales?${new URLSearchParams({ ...scopeQuery, dateFrom: filters.dateFrom, dateTo: filters.dateTo, view: 'orders', overview: 'true', confirmedOnly: 'true', status: '', paymentStatus: '', salesType: '', ...extra })}`;
  const collectionHref = `/cash-desk?${new URLSearchParams({ view: 'collections', fromOverview: 'true', ...scopeQuery, date: filters.dateTo })}`;
  const saleCompanies = companies.rows.length
    ? [...companies.rows]
        .sort((a, b) => Number(b.id === filters.companyId) - Number(a.id === filters.companyId))
        .map((company) => ({ ...company, code: company.code ?? '' }))
    : user?.companyId
      ? [{ id: user.companyId, name: 'Your company', code: '' }]
      : [];
  const save = () => {
    refresh();
    notifyDeskSaved('sales-desk');
  };
  return (
    <div className="sales-overview">
      <header className="sales-overview-header">
        <div>
          <p className="sales-overview-eyebrow">SALES DESK</p>
          <h1>Sales Overview</h1>
          <p>Sales performance, customer balances and your next steps.</p>
        </div>
        <div className="sales-overview-actions">
          <Btn
            variant="secondary"
            onClick={refresh}
            disabled={resource.loading || customers.loading}
            aria-label="Refresh sales overview"
          >
            <RefreshCw size={16} />
          </Btn>
          {canCustomers && hasPermission('customers.create') && (
            <Btn variant="secondary" onClick={() => setCreatingCustomer(true)}>
              <Users size={16} />
              Add customer
            </Btn>
          )}
          {canSales && hasPermission('sales.create') && (
            <Btn onClick={() => setCreatingSale(true)}>
              <Plus size={16} />
              New sale
            </Btn>
          )}
        </div>
      </header>
      {canSales && (
        <div className="sales-overview-filters">
          <div className="sales-overview-presets" role="group" aria-label="Sales overview period">
            {[
              ['today', 'Today'],
              ['week', 'This week'],
              ['month', 'This month'],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filters.preset === value}
                onClick={() => setFilters({ ...filters, ...overviewDates(value), preset: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="sales-overview-filter-fields">
            <label>
              From
              <input
                type="date"
                value={filters.dateFrom}
                max={filters.dateTo || overviewToday()}
                onChange={(event) =>
                  setFilters({ ...filters, dateFrom: event.target.value, preset: 'custom' })
                }
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom}
                max={overviewToday()}
                onChange={(event) =>
                  setFilters({ ...filters, dateTo: event.target.value, preset: 'custom' })
                }
              />
            </label>
            <label>
              Company
              <select
                value={filters.companyId}
                disabled={!hasPermission('companies.read') || companies.loading}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    companyId: event.target.value,
                    divisionId: '',
                    branchId: '',
                  })
                }
              >
                <option value="">All permitted companies</option>
                {saleCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Division
              <select
                value={filters.divisionId}
                disabled={
                  !filters.companyId || !hasPermission('divisions.read') || divisions.loading
                }
                onChange={(event) =>
                  setFilters({ ...filters, divisionId: event.target.value, branchId: '' })
                }
              >
                <option value="">All divisions</option>
                {divisions.rows.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Branch
              <select
                value={filters.branchId}
                disabled={
                  !filters.divisionId || !hasPermission('branches.read') || branches.loading
                }
                onChange={(event) => setFilters({ ...filters, branchId: event.target.value })}
              >
                <option value="">All branches</option>
                {branches.rows.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Currency
              <select
                value={filters.currency}
                onChange={(event) => setFilters({ ...filters, currency: event.target.value })}
              >
                {['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX'].map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
          </div>
          {(companies.error || divisions.error || branches.error) && (
            <p role="alert">
              Organisation choices could not load.{' '}
              <button
                onClick={() => {
                  companies.retry();
                  divisions.retry();
                  branches.retry();
                }}
              >
                Retry choices
              </button>
            </p>
          )}
        </div>
      )}
      {canSales && !validDates && (
        <p role="alert" className="sales-overview-error">
          Choose a start and end date, ending today or earlier.
        </p>
      )}
      {canSales && validDates && resource.loading && (
        <div role="status" className="sales-overview-loading">
          Loading your sales overview…
        </div>
      )}
      {resource.error && (
        <div role="alert" className="sales-overview-error">
          {resource.error}{' '}
          <Btn variant="secondary" onClick={resource.reload}>
            Retry overview
          </Btn>
        </div>
      )}
      {canSales && data && (
        <>
          <p className="sales-overview-context">
            {overviewDate(data.period.dateFrom, true)}–{overviewDate(data.period.dateTo, true)} ·{' '}
            {data.currency} · Compared with {overviewDate(data.period.previousFrom, true)}–
            {overviewDate(data.period.previousTo, true)}
          </p>
          <div className="sales-overview-metrics">
            {[
              {
                label: 'Sales value',
                value: overviewMoney(data.metrics.salesValue, data.currency),
                note: overviewChange(data.metrics.salesValue, data.metrics.previousSalesValue),
                href: salesHref(),
                icon: TrendingUp,
              },
              {
                label: 'Confirmed sales',
                value: data.metrics.salesCount.toLocaleString(),
                note: overviewChange(data.metrics.salesCount, data.metrics.previousSalesCount),
                href: salesHref(),
                icon: ArrowRight,
              },
              {
                label:
                  data.receiptBasis === 'scoped-settlements'
                    ? 'Scoped collections'
                    : 'Money collected',
                value: overviewMoney(data.metrics.collected, data.currency),
                note:
                  data.metrics.collected === null
                    ? 'Payment viewing access required'
                    : overviewChange(data.metrics.collected, data.metrics.previousCollected ?? 0),
                href: data.access.receipts ? '#sales-overview-receipts' : undefined,
                icon: Wallet,
              },
              {
                label: 'Outstanding now',
                value: overviewMoney(data.metrics.outstanding, data.currency),
                note: data.access.balances
                  ? `Current balances · ${overviewDate(data.asOf)}`
                  : 'Receivable viewing access required',
                href: canCollections ? collectionHref : undefined,
                icon: Clock3,
              },
              {
                label: 'Overdue now',
                value: overviewMoney(data.metrics.overdue, data.currency),
                note: data.access.balances
                  ? `${data.attention.overdue} sales need collection`
                  : 'Receivable viewing access required',
                href: data.access.balances ? '#sales-overview-overdue' : undefined,
                icon: Clock3,
                tone: 'overdue',
              },
              {
                label: 'Average sale value',
                value: overviewMoney(data.metrics.averageSale, data.currency),
                note: overviewChange(data.metrics.averageSale, data.metrics.previousAverageSale),
                href: salesHref(),
                icon: TrendingUp,
              },
            ].map((metric) => {
              const content = (
                <>
                  <span>
                    <metric.icon size={16} />
                    {metric.label}
                  </span>
                  <strong>{metric.value}</strong>
                  <small>{metric.note}</small>
                </>
              );
              return metric.href ? (
                <Link
                  key={metric.label}
                  className={`sales-overview-metric ${metric.tone ?? ''}`}
                  href={metric.href}
                >
                  {content}
                </Link>
              ) : (
                <div key={metric.label} className="sales-overview-metric">
                  {content}
                </div>
              );
            })}
          </div>
          <p className="sales-overview-definition">
            Sales value includes tax and agreed discounts, before credit notes and refunds.
            Collections follow effective receipt or allocation dates. Current balances cover all
            open sales in this scope.
            {data.receiptBasis === 'scoped-settlements' && (
              <>
                {' '}
                Scoped collections show settlements allocated to permitted sales; they may represent
                part of a receipt.
              </>
            )}
          </p>
          {!!data.warnings?.length && (
            <div className="sales-overview-definition" role="status">
              {data.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          <div className="sales-overview-main-grid">
            <OverviewTrend overview={data} salesHref={salesHref} />
            <OverviewPanel
              title="Needs attention"
              description="Open work across your selected organisation."
            >
              <div className="sales-overview-attention">
                <Link
                  href={salesHref({ status: 'DRAFT', confirmedOnly: '', dateFrom: '', dateTo: '' })}
                >
                  <span>
                    <Clock3 size={17} />
                    <span>
                      Draft sales<small>Ready for review and confirmation</small>
                    </span>
                  </span>
                  <strong>{data.attention.drafts}</strong>
                  <ArrowRight size={16} />
                </Link>
                {data.access.balances && (
                  <>
                    <Link href="#sales-overview-overdue">
                      <span>
                        <Clock3 size={17} />
                        <span>
                          Overdue sales<small>Customer payments past their due date</small>
                        </span>
                      </span>
                      <strong>{data.attention.overdue}</strong>
                      <ArrowRight size={16} />
                    </Link>
                    <Link href="#sales-overview-upcoming">
                      <span>
                        <Wallet size={17} />
                        <span>
                          Due in the next 7 days<small>Upcoming collections</small>
                        </span>
                      </span>
                      <strong>{data.attention.dueSoon}</strong>
                      <ArrowRight size={16} />
                    </Link>
                  </>
                )}
                {data.access.receipts && (
                  <Link href="/finance/payments">
                    <span>
                      <Wallet size={17} />
                      <span>
                        Unapplied payments
                        <small>Received in this period; awaiting allocation</small>
                      </span>
                    </span>
                    <strong>{data.attention.unappliedPayments}</strong>
                    <ArrowRight size={16} />
                  </Link>
                )}
              </div>
              {!!data.attention.draftSales.length && (
                <div className="sales-overview-drafts">
                  <p>Latest drafts</p>
                  {data.attention.draftSales.map((sale) => (
                    <Link key={sale.id} href={`/sales-desk/sales/${encodeURIComponent(sale.id)}`}>
                      <span>
                        {sale.reference}
                        <small>{sale.customer}</small>
                      </span>
                      <ArrowRight size={14} />
                    </Link>
                  ))}
                </div>
              )}
            </OverviewPanel>
          </div>
          <div className="sales-overview-three-grid">
            <OverviewPanel
              title="Sales mix"
              description="How confirmed sales were paid or invoiced."
            >
              <OverviewAmounts rows={data.salesMix} currency={data.currency} />
              {!data.salesMix.length && (
                <p className="sales-overview-empty">No confirmed sales in this period.</p>
              )}
              {data.access.receipts && (
                <>
                  <h3 className="sales-overview-subheading">Collection methods</h3>
                  <OverviewAmounts
                    rows={data.paymentMethods}
                    currency={data.currency}
                    tone="collected"
                  />
                  {!data.paymentMethods.length && (
                    <p className="sales-overview-empty">No collections in this period.</p>
                  )}
                </>
              )}
            </OverviewPanel>
            <OverviewPanel
              title="Receivables aging"
              description={`Current outstanding balances · ${overviewDate(data.asOf)}`}
            >
              {data.access.balances ? (
                <OverviewAmounts rows={data.aging} currency={data.currency} tone="overdue" />
              ) : (
                <p className="sales-overview-empty">Receivable viewing access is required.</p>
              )}
            </OverviewPanel>
            <OverviewPanel
              title="Customer activity"
              description="Customers buying and joining during this period."
              action={
                canCustomers && (
                  <Link className="sales-overview-text-link" href="/sales-desk/customers">
                    View customers <ArrowRight size={14} />
                  </Link>
                )
              }
            >
              {data.access.customers ? (
                <>
                  <div className="sales-overview-customer-stats">
                    <div>
                      <strong>{data.metrics.purchasingCustomers}</strong>
                      <span>Purchasing customers</span>
                    </div>
                    <div>
                      <strong>{data.metrics.newCustomers}</strong>
                      <span>New customer profiles</span>
                    </div>
                  </div>
                  <h3 className="sales-overview-subheading">Top customers by sales value</h3>
                  <OverviewRankingList
                    rows={data.topCustomers}
                    currency={data.currency}
                    href={(row) => `/sales-desk/customers/${encodeURIComponent(row.id)}`}
                  />
                </>
              ) : (
                <p className="sales-overview-empty">Customer viewing access is required.</p>
              )}
            </OverviewPanel>
          </div>
          {data.access.balances && (
            <>
              <OverviewCollectionsTable
                id="sales-overview-overdue"
                title="Overdue collections"
                description="Largest overdue balances, across all sale dates."
                rows={data.attention.overdueSales}
                currency={data.currency}
                empty="No overdue sales in this scope."
                action={
                  canCollections && (
                    <Link className="sales-overview-text-link" href={collectionHref}>
                      Open collections <ArrowRight size={14} />
                    </Link>
                  )
                }
              />
              <OverviewCollectionsTable
                id="sales-overview-upcoming"
                title="Upcoming collections"
                description="Next five collections due today or in the next 7 days, across all sale dates."
                rows={data.attention.dueSoonSales}
                currency={data.currency}
                empty="No collections due in the next 7 days."
              />
            </>
          )}
          <div className="sales-overview-three-grid">
            <OverviewPanel
              title="Best-selling products"
              description="Ranked by line value, before document discounts."
            >
              <ol className="sales-overview-ranking">
                {data.topProducts.map((product, index) => (
                  <li key={product.id}>
                    <span className="sales-overview-rank">{index + 1}</span>
                    <div>
                      <strong>{product.name}</strong>
                      <small>
                        {Number(product.quantity).toLocaleString()} {product.unit}
                      </small>
                    </div>
                    <span>{overviewMoney(product.amount, data.currency)}</span>
                  </li>
                ))}
              </ol>
              {!data.topProducts.length && (
                <p className="sales-overview-empty">No products sold in this period.</p>
              )}
            </OverviewPanel>
            <OverviewPanel
              title="Branch performance"
              description="Top branches by confirmed sales value."
            >
              <OverviewRankingList
                rows={data.branches}
                currency={data.currency}
                href={(row) => (row.id ? salesHref({ branchId: row.id }) : undefined)}
              />
            </OverviewPanel>
            <OverviewPanel
              title="Salesperson performance"
              description="Recorded salesperson attribution; unassigned sales stay visible."
            >
              <OverviewRankingList
                rows={data.salespeople}
                currency={data.currency}
                href={(row) => (row.id ? salesHref({ salespersonId: row.id }) : undefined)}
              />
            </OverviewPanel>
          </div>
          <OverviewPanel
            title="Recent sales"
            description="Latest sales in the selected period, including drafts and cancellations."
            action={
              <Link className="sales-overview-text-link" href={salesHref({ confirmedOnly: '' })}>
                View all sales <ArrowRight size={14} />
              </Link>
            }
          >
            <div className="sales-overview-table-wrap">
              <table>
                <caption className="sr-only">Recent sales in {data.currency}</caption>
                <thead>
                  <tr>
                    <th>Sale / customer</th>
                    <th>Date</th>
                    <th>Branch</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSales.map((sale) => (
                    <tr key={sale.id}>
                      <td>
                        <Link href={`/sales-desk/sales/${encodeURIComponent(sale.id)}`}>
                          {sale.reference}
                        </Link>
                        <small>{sale.customer}</small>
                      </td>
                      <td>{overviewDate(sale.date)}</td>
                      <td>{sale.branch}</td>
                      <td>{overviewMoney(sale.amount, data.currency)}</td>
                      <td>
                        <span className={`sales-overview-badge ${sale.status.toLowerCase()}`}>
                          {sale.status.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </td>
                      <td>{sale.paymentStatus.replace(/_/g, ' ').toLowerCase()}</td>
                      <td>
                        <Link
                          aria-label={`Open ${sale.reference}`}
                          href={`/sales-desk/sales/${encodeURIComponent(sale.id)}`}
                        >
                          <ArrowRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {!data.recentSales.length && (
                    <tr>
                      <td colSpan={7} className="sales-overview-empty">
                        No sales in this period. Choose another date range or create a sale.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </OverviewPanel>
          {data.access.receipts && (
            <OverviewPanel
              title="Recent collections"
              description={
                data.receiptBasis === 'scoped-settlements'
                  ? 'Settlements allocated to permitted sales, by effective allocation date; unapplied advances are excluded.'
                  : 'Posted receipts allocated to these sales, by effective receipt or allocation date; unapplied advances are excluded.'
              }
            >
              <div id="sales-overview-receipts" tabIndex={-1} className="sales-overview-receipts">
                {data.recentReceipts.map((receipt) => (
                  <div key={receipt.id}>
                    <span>
                      <strong>{receipt.reference}</strong>
                      <small>
                        {overviewDate(receipt.date)} ·{' '}
                        {receipt.method.replace(/_/g, ' ').toLowerCase()}
                      </small>
                    </span>
                    <strong>{overviewMoney(receipt.amount, data.currency)}</strong>
                    {receipt.saleId && (
                      <Link
                        aria-label={`View sale for ${receipt.reference}`}
                        href={`/sales-desk/sales/${encodeURIComponent(receipt.saleId)}`}
                      >
                        <ArrowRight size={16} />
                      </Link>
                    )}
                  </div>
                ))}
                {!data.recentReceipts.length && (
                  <p className="sales-overview-empty">No collections in this period.</p>
                )}
              </div>
            </OverviewPanel>
          )}
        </>
      )}
      {!canSales && canCustomers && (
        <OverviewPanel title="Customers" description="Customer relationships in your organisation.">
          {customers.error ? (
            <p role="alert">
              {customers.error} <button onClick={customers.reload}>Retry</button>
            </p>
          ) : customers.loading ? (
            <p role="status">Loading customers…</p>
          ) : (
            <p>
              {customers.data?.total ?? 0} customers · {customers.data?.active ?? 0} active ·{' '}
              {customers.data?.blocked ?? 0} blocked
            </p>
          )}
          <Link className="sales-overview-text-link" href="/sales-desk/customers">
            Open customers <ArrowRight size={14} />
          </Link>
        </OverviewPanel>
      )}
      <footer className="sales-overview-footer">
        {canCollections && (
          <Link href={collectionHref}>
            <Wallet size={16} />
            Cash Desk collections <ArrowRight size={14} />
          </Link>
        )}
        {hasPermission('sales_desk.view') && (
          <Link href="/sales-desk?source=direct&view=overview">
            Direct entries · Separate register <ArrowRight size={14} />
          </Link>
        )}
      </footer>
      {creatingSale && (
        <NewSale
          mode="create"
          companies={saleCompanies}
          onClose={() => setCreatingSale(false)}
          onSaved={() => {
            setCreatingSale(false);
            save();
          }}
        />
      )}
      {creatingCustomer && (
        <TradingPartnerEditor
          kind="customers"
          companyId={filters.companyId}
          onClose={() => setCreatingCustomer(false)}
          onSaved={() => {
            setCreatingCustomer(false);
            save();
          }}
        />
      )}
    </div>
  );
}
