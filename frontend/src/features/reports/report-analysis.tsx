'use client';
import { useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { money, type Directory, type Invoice } from '@/features/invoice-desk/types';
import type { Sale } from '@/features/sales-desk/types';
import type { ReportDefinition } from './report-definitions';
import type { Analysis, AnalysisRow, AnalysisTable } from './analysis-types';
import { AnalysisFilterForm, FilterCaption, useAnalysisFilters } from './analysis-filters';
import { AnalysisGrid } from './analysis-table';
import './report-analysis.css';
import { branchPerformance } from './branch-performance';

function Trend({
  data,
  currency,
  kind,
}: {
  data: Analysis;
  currency: string;
  kind: 'trade' | 'expense' | 'cash';
}) {
  const rows = (data.tables.find((t) => t.id === 'monthly')?.rows ?? [])
    .filter((r) => r.currency === currency)
    .slice(-12);
  const keys =
    kind === 'trade'
      ? ['issued', 'paid']
      : kind === 'expense'
        ? ['expenses']
        : ['inflow', 'outflow'];
  const cents = (v: string | number) => BigInt(String(v ?? '0').replace('.', ''));
  const maximum = rows.reduce(
    (max, r) => keys.reduce((m, k) => (cents(r[k]) > m ? cents(r[k]) : m), max),
    1n,
  );
  return (
    <div className="analysis-chart">
      <div className="analysis-chart-heading">
        <h2>Monthly trend</h2>
        <span>{currency} · latest 12 months in period</span>
      </div>
      {!rows.length ? (
        <p className="reports-empty">No activity in this period.</p>
      ) : (
        <div
          className="analysis-bars"
          role="img"
          aria-label={`Monthly ${kind} trend in ${currency}; exact figures are available in Monthly trend below.`}
        >
          {rows.map((r) => (
            <div className="analysis-bar-group" key={String(r.month)}>
              <div>
                {keys.map((k, i) => (
                  <span
                    key={k}
                    className={`analysis-bar analysis-bar-${i}`}
                    style={{ height: `${Number((cents(r[k]) * 100n) / maximum)}%` }}
                    title={`${r.month} · ${k}: ${money(String(r[k]), currency)}`}
                  />
                ))}
              </div>
              <small>{String(r.month)}</small>
            </div>
          ))}
        </div>
      )}
      <div className="analysis-chart-legend">
        {keys.map((key, i) => (
          <span key={key}>
            <i className={`analysis-bar-${i}`} />
            {
              (
                {
                  issued: 'Invoiced',
                  paid: 'Payments',
                  expenses: 'Paid expenses',
                  inflow: 'Money in',
                  outflow: 'Money out',
                } as Record<string, string>
              )[key]
            }
          </span>
        ))}
      </div>
    </div>
  );
}
function Summary({
  data,
  currency,
  mode,
  onExplore,
}: {
  data: Analysis;
  currency: string;
  mode: string;
  onExplore: (tab: string) => void;
}) {
  const c = data.currencies.find((c) => c.currency === currency);
  if (!c)
    return (
      <div className="reports-empty">
        No activity or opening balances for this scope and period.
      </div>
    );
  const cash = data.source === 'Cash Desk',
    expense = mode === 'expenses';
  const metrics = cash
    ? expense
      ? [
          ['Paid expenses', c.expenses, 'expenses'],
          ['Previous period', c.previous, 'monthly'],
        ]
      : [
          ['Opening cash', c.opening, 'accounts'],
          ['Money in', c.inflow, 'statement'],
          ['Money out', c.outflow, 'statement'],
          ['Closing cash', c.closing, 'accounts'],
        ]
    : [
        ['Opening balance', c.opening, 'statement'],
        [
          data.source === 'Sales Desk' ? 'Sales in period' : 'Purchases in period',
          c.issued,
          'documents',
        ],
        ['Payments in period', c.paid, 'payments'],
        ['Closing balance', c.closing, 'statement'],
        ['Overdue at period end', c.overdue, 'overdue'],
      ];
  return (
    <>
      <div className="analysis-metrics">
        {metrics.map(([label, value, tab]) => (
          <button key={label} onClick={() => onExplore(tab!)}>
            <span>
              {label}
              <ArrowUpRight size={13} />
            </span>
            <strong>{money(value ?? '0', currency)}</strong>
          </button>
        ))}
      </div>
      {(!cash || expense) && (
        <p className="analysis-comparison">
          {c.change === null
            ? 'No previous-period baseline'
            : `${c.change}% ${expense ? 'expense' : 'invoiced amount'} change`}{' '}
          · Previous period {data.period.previousFrom} to {data.period.previousTo}:{' '}
          {money(c.previous, currency)}.
        </p>
      )}
    </>
  );
}
function DocumentDetail({
  id,
  source,
  onClose,
}: {
  id: string;
  source: 'sales' | 'purchases';
  onClose: () => void;
}) {
  const path = source === 'sales' ? `/sales-desk/sales/${id}` : `/invoice-desk/invoices/${id}`;
  const item = useWorkspaceResource<Sale | Invoice>(path),
    r = item.data;
  return (
    <Modal open title="Invoice details" onClose={onClose}>
      {item.loading ? (
        <p role="status">Loading invoice…</p>
      ) : item.error ? (
        <p role="alert">{item.error}</p>
      ) : r ? (
        <div className="analysis-document">
          <h3>{'saleNumber' in r ? r.saleNumber : r.invoiceNumber}</h3>
          <p>
            {'customer' in r ? r.customer.name : r.supplier.name} · {r.company.name} ·{' '}
            {r.division.name} · {r.branch.name}
          </p>
          <dl>
            <dt>Total</dt>
            <dd>{money(r.totalAmount, r.currency)}</dd>
            <dt>Paid now</dt>
            <dd>{money(r.paidAmount, r.currency)}</dd>
            <dt>Outstanding now</dt>
            <dd>{money(r.outstanding, r.currency)}</dd>
            <dt>Status</dt>
            <dd>{r.status}</dd>
          </dl>
          {'description' in r && <p>{r.description}</p>}
          {'lines' in r &&
            r.lines?.map((line) => (
              <p key={line.id}>
                {line.description} · {line.quantity} × {money(line.unitPrice, r.currency)} ={' '}
                {money(line.totalAmount, r.currency)}
              </p>
            ))}
          <h4>Payment history</h4>
          {r.payments?.length ? (
            r.payments.map((p) => (
              <p key={p.id}>
                {p.paymentDate.slice(0, 10)} · {money(p.amount, r.currency)} ·{' '}
                {p.reference || 'No reference'}
                {p.reversedAt ? ' · Reversed' : ''}
              </p>
            ))
          ) : (
            <p>No payments recorded.</p>
          )}
          <p className="reports-footnote">
            This is the current source record. The report uses its selected period end.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
export function ReportAnalysis({ report }: { report: ReportDefinition }) {
  const isCash = report.id === 'cash' || report.id === 'expenses',
    source = isCash
      ? 'cash'
      : report.id === 'suppliers' || report.id === 'purchases'
        ? 'purchases'
        : 'sales';
  const { filters, query, tab, apply } = useAnalysisFilters(report.id);
  const directory = useWorkspaceResource<Directory>(report.directory);
  const data = useWorkspaceResource<Analysis>(`/desk-reports/${source}`, query);
  const parties = useWorkspaceResource<{ id: string; name: string }[]>(
    source === 'sales' ? '/sales-desk/customers' : '/invoice-desk/suppliers',
    filters.companyId ? { companyId: filters.companyId } : {},
    !isCash,
  );
  const [currency, setCurrency] = useState(''),
    [document, setDocument] = useState('');
  const current =
    data.data?.currencies.find((c) => c.currency === currency)?.currency ??
    data.data?.currencies[0]?.currency ??
    filters.currency;
  const tabs = data.data?.tables ?? [];
  const active =
    tab ||
    (report.id === 'customers' || report.id === 'suppliers'
      ? 'parties'
      : report.id === 'expenses'
        ? 'categories'
        : report.id === 'cash'
          ? 'accounts'
          : 'branches');
  const selected = tabs.find((t) => t.id === active) ?? tabs[0];
  const table: AnalysisTable | undefined = selected
    ? { ...selected, rows: selected.rows.filter((r) => !current || r.currency === current) }
    : undefined;
  const drill = (r: AnalysisRow) => {
    if (table?.id === 'branches')
      apply(
        {
          companyId: String(r.companyId),
          divisionId: String(r.divisionId),
          branchId: String(r.branchId),
        },
        isCash ? 'expenses' : 'documents',
      );
    else apply({ partyId: String(r.partyId ?? r.id), currency: String(r.currency) }, 'statement');
  };
  return (
    <>
      <header className="reports-heading reports-report-heading">
        <div>
          <p className="reports-eyebrow">{report.source.toUpperCase()} · ANALYSIS</p>
          <h1>
            {report.id === 'customers'
              ? 'Customer reports'
              : report.id === 'suppliers'
                ? 'Supplier reports'
                : report.name}
          </h1>
          <p>
            {isCash
              ? 'Understand spending, account activity and balances.'
              : 'Understand activity, payment history and balances, from summary to individual invoice.'}
          </p>
        </div>
        <button aria-label="Refresh analysis" onClick={() => data.reload()}>
          <RefreshCw size={16} />
        </button>
      </header>
      <AnalysisFilterForm
        key={JSON.stringify(filters)}
        value={filters}
        directory={directory.data}
        onApply={(next) => apply(next, active)}
        parties={parties.data ?? undefined}
        partyLabel={isCash ? undefined : source === 'sales' ? 'Customer' : 'Supplier'}
      />
      <FilterCaption filters={filters} directory={directory.data} />
      {filters.partyId && (
        <p className="analysis-selected-party">
          {parties.data?.find((p) => p.id === filters.partyId)?.name ?? 'Selected account'}{' '}
          <button onClick={() => apply({ partyId: '' }, 'parties')}>Clear account</button>
        </p>
      )}
      {directory.error && (
        <p className="reports-error" role="alert">
          Organisation filters unavailable. <button onClick={directory.reload}>Retry</button>
        </p>
      )}
      {!isCash && parties.error && (
        <p className="reports-error" role="alert">
          Counterparty directory unavailable. <button onClick={parties.reload}>Retry</button>
        </p>
      )}
      {data.loading ? (
        <p role="status" className="reports-empty">
          Preparing report…
        </p>
      ) : data.error ? (
        <p role="alert" className="reports-error">
          {data.error} <button onClick={data.reload}>Retry report</button>
        </p>
      ) : data.data ? (
        <>
          <div className="analysis-currency">
            <span>Generated {new Date(data.data.generatedAt).toLocaleString()}</span>
            <label>
              Display currency
              <select
                value={current}
                disabled={!data.data.currencies.length}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  apply({ currency: e.target.value }, active);
                }}
              >
                {!data.data.currencies.length && <option value="">No activity</option>}
                {data.data.currencies.map((c) => (
                  <option key={c.currency}>{c.currency}</option>
                ))}
              </select>
            </label>
          </div>
          <Summary
            data={data.data}
            currency={current}
            mode={report.id}
            onExplore={(next) => apply({}, next)}
          />
          <Trend
            data={data.data}
            currency={current}
            kind={report.id === 'expenses' ? 'expense' : isCash ? 'cash' : 'trade'}
          />
          <nav className="analysis-tabs" aria-label="Analysis views">
            {tabs.map((t) => (
              <button
                key={t.id}
                aria-current={t.id === table?.id ? 'page' : undefined}
                onClick={() => apply({}, t.id)}
              >
                {t.title}
              </button>
            ))}
          </nav>
          {table?.id === 'statement' && (
            <div className="analysis-statement-note">
              <strong>
                Opening{' '}
                {money(
                  data.data.currencies.find((c) => c.currency === current)?.opening ?? '0',
                  current,
                )}{' '}
                → Closing{' '}
                {money(
                  data.data.currencies.find((c) => c.currency === current)?.closing ?? '0',
                  current,
                )}
              </strong>
              <p>
                {isCash
                  ? 'Combined cash book for the selected accounts, with a running balance per currency.'
                  : filters.partyId
                    ? 'Statement for the selected account.'
                    : 'Combined statement for the selected scope, with a running balance per currency. Choose a customer or supplier for their individual statement.'}
              </p>
            </div>
          )}
          {table && (
            <AnalysisGrid
              companyId={filters.companyId || undefined}
              key={`${table.id}:${current}:${data.data.generatedAt}`}
              table={table}
              caption={`${current || 'All currencies'} · ${filters.from} to ${filters.to}`}
              metadata={{
                Source: report.source,
                Company:
                  directory.data?.companies.find((c) => c.id === filters.companyId)?.name ||
                  filters.companyId ||
                  'All accessible companies',
                Division:
                  directory.data?.divisions.find((d) => d.id === filters.divisionId)?.name ||
                  filters.divisionId ||
                  'All accessible divisions',
                Branch:
                  directory.data?.branches.find((b) => b.id === filters.branchId)?.name ||
                  filters.branchId ||
                  'All accessible branches',
                Account:
                  parties.data?.find((p) => p.id === filters.partyId)?.name ||
                  filters.partyId ||
                  'All accessible accounts',
                'Generated at': data.data.generatedAt,
                Basis: data.data.basis,
                ...(table.id === 'statement'
                  ? {
                      'Opening balance':
                        data.data.currencies.find((c) => c.currency === current)?.opening ?? '0.00',
                      'Closing balance':
                        data.data.currencies.find((c) => c.currency === current)?.closing ?? '0.00',
                    }
                  : {}),
              }}
              onDrill={['parties', 'ageing', 'branches'].includes(table.id) ? drill : undefined}
              onDocument={
                !isCash && ['documents', 'overdue', 'payments', 'statement'].includes(table.id)
                  ? (id) => setDocument(id)
                  : undefined
              }
            />
          )}
          <details className="analysis-basis">
            <summary>How this report is calculated</summary>
            <p>{data.data.basis}</p>
            <p>
              Figures cover the selected scope. Sales and Invoice Desk records are separate from
              older ERP transactions. Currency amounts are never combined.
            </p>
          </details>
        </>
      ) : null}
      {document && !isCash && (
        <DocumentDetail
          id={document}
          source={source as 'sales' | 'purchases'}
          onClose={() => setDocument('')}
        />
      )}
    </>
  );
}

export function BusinessOverview() {
  const { hasPermission } = useAuth(),
    { filters, query, apply, href } = useAnalysisFilters('');
  const salesAllowed = hasPermission('sales_desk.view'),
    purchaseAllowed = hasPermission('invoice_desk.view'),
    cashAllowed = hasPermission('cash_desk.view');
  const directory = useWorkspaceResource<Directory>(
    salesAllowed
      ? '/sales-desk/directory'
      : purchaseAllowed
        ? '/invoice-desk/directory'
        : '/cash-desk/directory',
    {},
    salesAllowed || purchaseAllowed || cashAllowed,
  );
  const sales = useWorkspaceResource<Analysis>('/desk-reports/sales', query, salesAllowed),
    purchases = useWorkspaceResource<Analysis>('/desk-reports/purchases', query, purchaseAllowed),
    cash = useWorkspaceResource<Analysis>('/desk-reports/cash', query, cashAllowed);
  const [currency, setCurrency] = useState('');
  const currencies = [
    ...new Set(
      [
        ...(sales.data?.currencies ?? []),
        ...(purchases.data?.currencies ?? []),
        ...(cash.data?.currencies ?? []),
      ].map((c) => c.currency),
    ),
  ].sort();
  const current = currencies.includes(currency)
    ? currency
    : (currencies[0] ?? filters.currency ?? 'TZS');
  if (!salesAllowed && !purchaseAllowed && !cashAllowed) return null;
  const cards = [
    {
      title: 'Sales',
      allowed: salesAllowed,
      resource: sales,
      key: 'issued',
      view: 'sales',
      tab: 'documents',
      description: 'Invoices raised in the period',
    },
    {
      title: 'Customers owe',
      allowed: salesAllowed,
      resource: sales,
      key: 'closing',
      view: 'customers',
      tab: 'ageing',
      description: 'Balance at the period end',
    },
    {
      title: 'Purchases',
      allowed: purchaseAllowed,
      resource: purchases,
      key: 'issued',
      view: 'purchases',
      tab: 'documents',
      description: 'Purchase invoices in the period',
    },
    {
      title: 'Suppliers owed',
      allowed: purchaseAllowed,
      resource: purchases,
      key: 'closing',
      view: 'suppliers',
      tab: 'ageing',
      description: 'Balance at the period end',
    },
    {
      title: 'Paid expenses',
      allowed: cashAllowed,
      resource: cash,
      key: 'expenses',
      view: 'expenses',
      tab: 'categories',
      description: 'Unreversed spending in the period',
    },
    {
      title: 'Closing cash',
      allowed: cashAllowed,
      resource: cash,
      key: 'closing',
      view: 'cash',
      tab: 'accounts',
      description: 'Cash, bank and mobile money',
    },
  ];
  return (
    <section className="business-overview" aria-label="Business overview">
      <AnalysisFilterForm
        key={JSON.stringify(filters)}
        value={filters}
        directory={directory.data}
        onApply={(next) => apply(next)}
      />
      <FilterCaption filters={filters} directory={directory.data} />
      {directory.error && (
        <p role="alert" className="reports-error">
          Organisation filters could not load. <button onClick={directory.reload}>Retry</button>
        </p>
      )}
      <div className="analysis-currency">
        <h2>Business overview</h2>
        <label>
          Display currency
          <select
            value={current}
            disabled={!currencies.length}
            onChange={(e) => {
              setCurrency(e.target.value);
              apply({ currency: e.target.value });
            }}
          >
            {!currencies.length && <option value="">No activity</option>}
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="business-metrics">
        {cards
          .filter((c) => c.allowed)
          .map((c) => {
            const summary = c.resource.data?.currencies.find((x) => x.currency === current),
              value = summary?.[c.key as keyof typeof summary];
            return (
              <div key={c.title}>
                <span>{c.title}</span>
                {c.resource.loading ? (
                  <p role="status">Loading…</p>
                ) : c.resource.error ? (
                  <p role="alert">
                    Unavailable <button onClick={c.resource.reload}>Retry</button>
                  </p>
                ) : (
                  <Link href={href(c.view, { currency: current, partyId: '' }, c.tab)}>
                    <strong>
                      {value !== undefined ? money(String(value), current) : 'No activity'}
                    </strong>
                    <ArrowUpRight size={16} />
                  </Link>
                )}
                <small>{c.description}</small>
              </div>
            );
          })}
      </div>
      <p className="reports-footnote">
        These figures describe different parts of the business; they are not a profit calculation.
        Select a card to see its breakdown and records. Reports use currently valid source records.
      </p>
      {!!sales.data?.currencies.length && (
        <Trend data={sales.data} currency={current} kind="trade" />
      )}
      {(!salesAllowed || sales.data) &&
        (!purchaseAllowed || purchases.data) &&
        (!cashAllowed || cash.data) && (
          <AnalysisGrid
            companyId={filters.companyId || undefined}
            key={`${JSON.stringify(query)}:${current}`}
            table={branchPerformance(sales.data, purchases.data, cash.data, current)}
            caption={`${current || 'All currencies'} · ${filters.from} to ${filters.to}`}
            onDrill={(r) =>
              apply({
                companyId: String(r.companyId),
                divisionId: String(r.divisionId),
                branchId: String(r.branchId),
                partyId: '',
              })
            }
          />
        )}
    </section>
  );
}
