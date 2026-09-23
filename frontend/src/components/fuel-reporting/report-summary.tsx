'use client';
import { amount, type Report, type Summary } from './types';
import { Section } from './report-fields';

export function SummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className="fr-metrics">
      <div>
        <span>Fuel sold</span>
        <strong>
          {amount(summary.litres, 3)} <small>L</small>
        </strong>
      </div>
      <div>
        <span>Pump sales</span>
        <strong>
          {amount(summary.sales)} <small>TZS</small>
        </strong>
      </div>
      <div>
        <span>Collections</span>
        <strong>
          {amount(summary.collected)} <small>TZS</small>
        </strong>
      </div>
      <div className={summary.flagged ? 'fr-metric-warning' : ''}>
        <span>Discrepancies</span>
        <strong>
          {summary.flagged}
          <small> recorded</small>
        </strong>
      </div>
    </div>
  );
}
export function Discrepancies({ summary }: { summary: Summary }) {
  return (
    <Section
      title="Reconciliation"
      detail="Negative differences indicate shortages; positive differences indicate excesses. Fuel stock is reconciled by type across all its tanks."
    >
      <div className="fr-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Expected</th>
              <th>Reported / measured</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            {summary.discrepancies.map((r, i) => (
              <tr key={`${r.kind}-${i}`}>
                <td>
                  {r.label}
                  <small>{r.kind.replaceAll('_', ' ').toLowerCase()}</small>
                </td>
                <td className="fr-number">
                  {amount(r.expected, r.unit === 'L' ? 3 : 2)} {r.unit}
                </td>
                <td className="fr-number">
                  {amount(r.actual, r.unit === 'L' ? 3 : 2)} {r.unit}
                </td>
                <td className={r.difference ? 'fr-variance' : 'fr-number'}>
                  {r.difference > 0 ? '+' : ''}
                  {amount(r.difference, r.unit === 'L' ? 3 : 2)} {r.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!summary.discrepancies.length ? (
        <p className="fr-empty">Complete readings and collections to calculate discrepancies.</p>
      ) : null}
    </Section>
  );
}
function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
}
export function downloadCsv(name: string, rows: unknown[][]) {
  const blob = new Blob(['\uFEFF', rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function DailySummary({
  reports,
  date,
  branchName,
}: {
  reports: Report[];
  date: string;
  branchName: string;
}) {
  const closed = reports.filter((r) => r.status === 'CLOSED');
  const complete = closed.length === 2;
  const total = (
    field:
      | 'sales'
      | 'litres'
      | 'collected'
      | 'credit'
      | 'expenses'
      | 'purchases'
      | 'cashOut'
      | 'expectedCash'
      | 'flagged',
  ) => closed.reduce((acc, r) => acc + r.summary[field], 0);
  const products = [
    ...new Map(
      closed.flatMap((r) => r.summary.stock.map((s) => [s.productId, s.productName] as const)),
    ).entries(),
  ];
  return (
    <>
      <div className="fr-day-heading">
        <div>
          <h2>
            {branchName} · {date}
          </h2>
          <p>
            {complete
              ? 'Both shifts are closed. Daily consolidation is complete.'
              : 'Provisional daily totals include closed shifts only.'}
          </p>
        </div>
        <span className={`fr-badge ${complete ? 'fr-badge-closed' : ''}`}>
          {complete ? 'Complete day' : `${closed.length} of 2 shifts closed`}
        </span>
      </div>
      <div className="fr-shift-cards">
        {['DAY', 'NIGHT'].map((shift) => {
          const report = reports.find((r) => r.shift === shift);
          return (
            <div key={shift}>
              <span>{shift === 'DAY' ? '☀ Day shift' : '☾ Night shift'}</span>
              <strong>
                {report?.status === 'CLOSED'
                  ? 'Closed'
                  : report
                    ? 'Draft — not in totals'
                    : 'Not reported'}
              </strong>
              <small>
                {report?.closedAt
                  ? `Closed ${new Date(report.closedAt).toLocaleString('en-TZ', { timeZone: 'Africa/Dar_es_Salaam' })}`
                  : 'Awaiting station manager'}
              </small>
            </div>
          );
        })}
      </div>
      <div className="fr-metrics">
        <div>
          <span>Fuel sold</span>
          <strong>
            {amount(total('litres'), 3)} <small>L</small>
          </strong>
        </div>
        <div>
          <span>Sales</span>
          <strong>
            {amount(total('sales'))} <small>TZS</small>
          </strong>
        </div>
        <div>
          <span>Expenses</span>
          <strong>
            {amount(total('expenses'))} <small>TZS</small>
          </strong>
        </div>
        <div>
          <span>Recorded discrepancies</span>
          <strong>{total('flagged')}</strong>
        </div>
      </div>
      <Section title="Daily performance">
        <div className="fr-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Measure · TZS</th>
                <th>Day</th>
                <th>Night</th>
                <th>Daily total</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['sales', 'Pump sales'],
                  ['collected', 'Collections'],
                  ['credit', 'Credit sales'],
                  ['expenses', 'Expenses'],
                  ['purchases', 'Known purchase costs'],
                  ['cashOut', 'Paid out of shift cash'],
                  ['expectedCash', 'Expected cash handover'],
                ] as const
              ).map(([key, label]) => (
                <tr key={key}>
                  <td>{label}</td>
                  {['DAY', 'NIGHT'].map((s) => (
                    <td key={s} className="fr-number">
                      {amount(closed.find((r) => r.shift === s)?.summary[key])}
                    </td>
                  ))}
                  <td className="fr-number">
                    <strong>{amount(total(key))}</strong>
                  </td>
                </tr>
              ))}
              <tr>
                <td>Actual cash handover</td>
                {['DAY', 'NIGHT'].map((s) => (
                  <td key={s} className="fr-number">
                    {amount(closed.find((r) => r.shift === s)?.payload.collections.cashHandedOver)}
                  </td>
                ))}
                <td className="fr-number">
                  <strong>
                    {amount(
                      closed.reduce(
                        (acc, r) => acc + (r.payload.collections.cashHandedOver ?? 0),
                        0,
                      ),
                    )}
                  </strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {closed.some((r) => r.summary.unpricedDeliveries) ? (
          <p className="fr-notice">
            Some deliveries have no purchase cost yet. Known purchase costs are incomplete.
          </p>
        ) : null}
      </Section>
      <Section title="Fuel movement by type">
        <div className="fr-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fuel</th>
                <th>Received · L</th>
                <th>Sold · L</th>
                <th>Day dip difference · L</th>
                <th>Night dip difference · L</th>
              </tr>
            </thead>
            <tbody>
              {products.map(([id, name]) => (
                <tr key={id}>
                  <td>{name}</td>
                  <td className="fr-number">
                    {amount(
                      closed.reduce(
                        (sum, r) =>
                          sum + (r.summary.stock.find((s) => s.productId === id)?.received ?? 0),
                        0,
                      ),
                      3,
                    )}
                  </td>
                  <td className="fr-number">
                    {amount(
                      closed.reduce(
                        (sum, r) =>
                          sum + (r.summary.stock.find((s) => s.productId === id)?.sold ?? 0),
                        0,
                      ),
                      3,
                    )}
                  </td>
                  {['DAY', 'NIGHT'].map((s) => (
                    <td key={s} className="fr-number">
                      {amount(
                        closed
                          .find((r) => r.shift === s)
                          ?.summary.stock.find((p) => p.productId === id)?.difference,
                        3,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <button
        type="button"
        className="fr-secondary"
        onClick={() =>
          downloadCsv(`fuel-report-${date}.csv`, [
            [
              'Branch',
              'Business date',
              'Shift',
              'Status',
              'Litres sold',
              'Sales TZS',
              'Collections TZS',
              'Credit TZS',
              'Expenses TZS',
              'Known purchases TZS',
              'Discrepancies',
            ],
            ...['DAY', 'NIGHT'].map((shift) => {
              const r = reports.find((x) => x.shift === shift);
              return [
                branchName,
                date,
                shift,
                r?.status ?? 'MISSING',
                r?.summary.litres,
                r?.summary.sales,
                r?.summary.collected,
                r?.summary.credit,
                r?.summary.expenses,
                r?.summary.purchases,
                r?.summary.flagged,
              ];
            }),
          ])
        }
      >
        Export daily report · CSV
      </button>
    </>
  );
}
