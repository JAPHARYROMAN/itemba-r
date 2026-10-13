'use client';
import type { ComponentProps, ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import {
  overviewDate,
  overviewMoney,
  type OverviewRanking,
  type OverviewSale,
  type SalesOverview,
} from './sales-overview-types';

/** Scroll inside the active app window rather than adding fragment-only app history. */
export function OverviewLink({ href, ...props }: ComponentProps<'a'> & { href: string }) {
  if (!href.startsWith('#')) return <Link href={href} {...props} />;
  return (
    <a
      {...props}
      href={href}
      data-preserve-workspace=""
      onClick={(event) => {
        props.onClick?.(event);
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        const target = event.currentTarget
          .closest('.sales-overview')
          ?.querySelector<HTMLElement>(href);
        target?.scrollIntoView({
          block: 'start',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        });
        target?.focus({ preventScroll: true });
      }}
    />
  );
}

export function OverviewCollectionsTable({
  id,
  title,
  description,
  rows,
  currency,
  empty,
  action,
}: {
  id: string;
  title: string;
  description: string;
  rows: (OverviewSale & { dueDate: string | null })[];
  currency: string;
  empty: string;
  action?: ReactNode;
}) {
  return (
    <OverviewPanel title={title} description={description} action={action}>
      <div id={id} tabIndex={-1} className="sales-overview-table-wrap">
        <table>
          <caption className="sr-only">
            {title} in {currency}
          </caption>
          <thead>
            <tr>
              <th>Customer / sale</th>
              <th>Due date</th>
              <th>Branch</th>
              <th>Outstanding</th>
              <th>
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((sale) => (
              <tr key={sale.id}>
                <td>
                  <strong>{sale.customer}</strong>
                  <small>{sale.reference}</small>
                </td>
                <td>{sale.dueDate ? overviewDate(sale.dueDate) : '—'}</td>
                <td>{sale.branch}</td>
                <td>{overviewMoney(sale.outstanding, currency)}</td>
                <td>
                  <Link href={`/sales-desk/sales/${encodeURIComponent(sale.id)}`}>
                    View sale <ArrowRight size={14} />
                  </Link>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="sales-overview-empty">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </OverviewPanel>
  );
}

export function OverviewPanel({
  title,
  description,
  children,
  action,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`sales-overview-panel ${className}`} aria-label={title}>
      <div className="sales-overview-panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function OverviewRankingList({
  rows,
  currency,
  href,
}: {
  rows: OverviewRanking[];
  currency: string;
  href?: (row: OverviewRanking) => string | undefined;
}) {
  if (!rows.length)
    return <p className="sales-overview-empty">No confirmed sales in this period.</p>;
  return (
    <ol className="sales-overview-ranking">
      {rows.map((row, index) => (
        <li key={row.id}>
          <span className="sales-overview-rank">{index + 1}</span>
          <div>
            {href?.(row) ? <Link href={href(row)!}>{row.name}</Link> : <strong>{row.name}</strong>}
            <small>{row.count.toLocaleString()} sales</small>
          </div>
          <span>{overviewMoney(row.amount, currency)}</span>
        </li>
      ))}
    </ol>
  );
}

export function OverviewAmounts({
  rows,
  currency,
  tone = 'sales',
}: {
  rows: { label: string; amount: string }[];
  currency: string;
  tone?: string;
}) {
  const max = Math.max(0, ...rows.map((row) => Number(row.amount)));
  return (
    <div className="sales-overview-amounts">
      {rows.map((row) => (
        <div key={row.label}>
          <div>
            <span>{row.label}</span>
            <strong>{overviewMoney(row.amount, currency)}</strong>
          </div>
          <div className="sales-overview-track" aria-hidden="true">
            <span
              className={tone}
              style={{ width: `${max ? (Number(row.amount) / max) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function OverviewTrend({
  overview,
  salesHref,
}: {
  overview: SalesOverview;
  salesHref: (params?: Record<string, string>) => string;
}) {
  const { trend, currency } = overview;
  const maximum = Math.max(
    0,
    ...trend.flatMap((point) => [Number(point.sales), Number(point.collected ?? 0)]),
  );
  return (
    <OverviewPanel
      title="Sales performance"
      description="Confirmed sales and money collected by date."
      action={
        <Link className="sales-overview-text-link" href={salesHref()}>
          View sales <ArrowRight size={14} />
        </Link>
      }
    >
      <div className="sales-overview-chart-legend">
        <span>
          <i className="sales" />
          Sales value
        </span>
        {overview.access.receipts && (
          <span>
            <i className="collected" />
            Collected
          </span>
        )}
        <small>{currency}</small>
      </div>
      {maximum ? (
        <div className="sales-overview-chart">
          <div className="sales-overview-chart-scale">
            <span>{new Intl.NumberFormat('en-GB', { notation: 'compact' }).format(maximum)}</span>
            <span>0</span>
          </div>
          <div className="sales-overview-chart-columns">
            {trend.map((point) => (
              <Link
                key={point.date}
                href={salesHref({ dateFrom: point.date, dateTo: point.dateTo })}
                aria-label={`${overviewDate(point.date)}${point.dateTo !== point.date ? `–${overviewDate(point.dateTo)}` : ''}: sales ${overviewMoney(point.sales, currency)}${point.collected !== null ? `, collected ${overviewMoney(point.collected, currency)}` : ''}`}
                title={`${overviewDate(point.date)}${point.dateTo !== point.date ? `–${overviewDate(point.dateTo)}` : ''}\nSales: ${overviewMoney(point.sales, currency)}\nCollected: ${overviewMoney(point.collected, currency)}`}
              >
                <span
                  className="sales"
                  style={{ height: `${(Number(point.sales) / maximum) * 100}%` }}
                />
                {point.collected !== null && (
                  <span
                    className="collected"
                    style={{ height: `${(Number(point.collected) / maximum) * 100}%` }}
                  />
                )}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <p className="sales-overview-empty sales-overview-chart-empty">
          No sales or collections in this period.
        </p>
      )}
      <div className="sales-overview-chart-dates">
        <span>{overviewDate(overview.period.dateFrom)}</span>
        <span>{overviewDate(overview.period.dateTo)}</span>
      </div>
      <details className="sales-overview-chart-data">
        <summary>
          {trend.some((point) => point.date !== point.dateTo)
            ? 'View figures by date range'
            : 'View daily figures'}
        </summary>
        <div className="sales-overview-table-wrap">
          <table>
            <caption className="sr-only">Sales performance in {currency}</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Sales value</th>
                {overview.access.receipts && <th>Collected</th>}
              </tr>
            </thead>
            <tbody>
              {trend.map((point) => (
                <tr key={point.date}>
                  <td>
                    {overviewDate(point.date)}
                    {point.date !== point.dateTo && `–${overviewDate(point.dateTo)}`}
                  </td>
                  <td>{overviewMoney(point.sales, currency)}</td>
                  {overview.access.receipts && <td>{overviewMoney(point.collected, currency)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </OverviewPanel>
  );
}
