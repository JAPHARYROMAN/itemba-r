'use client';
import { useMemo, useState } from 'react';
import { Btn, Card } from '@/components/ui';
import { FormInput, FormSelect } from '@/components/aurora';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { MiniTrendLine } from '@/components/aurora/charts';
import { WorkspaceLink } from '@/components/workspace/workspace-navigation';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { flattenForCsv, isPrimitiveOrDate, pickPrimaryTable } from '@/lib/report-export';
import { reportChartPoints, safeReportLink } from './report-viewer-utils';
import type { ReportPresentation } from './report-viewer-types';
import type { ReportExecution } from './use-report-execution';

function ResultTable({
  rows,
  title,
  search = '',
}: {
  rows: Record<string, unknown>[];
  title: string;
  search?: string;
}) {
  const [page, setPage] = useState(1);
  const table = useMemo(() => flattenForCsv(rows), [rows]);
  const filtered = useMemo(
    () =>
      table.data.filter((row) =>
        row.some((cell) => cell.toLowerCase().includes(search.toLowerCase())),
      ),
    [table.data, search],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 50)),
    current = Math.min(page, pages);
  return (
    <>
      <WorkspaceTable label={title}>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.slice((current - 1) * 50, current * 50).map((row, index) => (
            <tr key={index}>
              {row.map((value, cell) => (
                <td key={cell}>{value || '—'}</td>
              ))}
            </tr>
          ))}
          {!filtered.length && (
            <tr>
              <td colSpan={Math.max(1, table.columns.length)}>No rows match this search.</td>
            </tr>
          )}
        </tbody>
      </WorkspaceTable>
      <nav className="report-pagination" aria-label={`${title} pages`}>
        <Btn variant="secondary" disabled={current === 1} onClick={() => setPage(current - 1)}>
          Previous rows
        </Btn>
        <span>
          {filtered.length} rows · Page {current} of {pages}
        </span>
        <Btn variant="secondary" disabled={current === pages} onClick={() => setPage(current + 1)}>
          Next rows
        </Btn>
      </nav>
    </>
  );
}
export function ReportResults({
  result,
  stateKey,
  presentation,
  setPresentation,
}: {
  result: ReportExecution;
  stateKey: string;
  presentation: ReportPresentation;
  setPresentation: (next: ReportPresentation) => void;
}) {
  const [search, setSearch] = useWorkspaceState(`${stateKey}.rowSearch`, '');
  const primary = useMemo(() => pickPrimaryTable(result.data), [result.data]);
  const table = useMemo(() => flattenForCsv(primary.rows), [primary.rows]);
  const numeric = useMemo(
    () =>
      table.columns.filter((_, col) => {
        const values = table.data.map((row) => row[col]).filter((value) => value?.trim());
        return values.length > 0 && values.every((value) => Number.isFinite(Number(value)));
      }),
    [table],
  );
  const metrics = presentation.metricColumns?.filter((column) => numeric.includes(column));
  const selected = metrics ?? numeric.slice(0, 4);
  const entries =
    result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? Object.entries(result.data as Record<string, unknown>)
      : [];
  const scalars = entries.filter(([, value]) => isPrimitiveOrDate(value));
  const additional = entries.filter(
    ([key, value]) => key !== primary.key && !isPrimitiveOrDate(value),
  );
  return (
    <>
      {!!scalars.length && (
        <Card className="report-viewer-section">
          <h3>Summary</h3>
          <dl className="report-facts">
            {scalars.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value == null ? '—' : String(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      {!!primary.rows.length && (
        <Card className="report-viewer-section">
          <header>
            <h3>{primary.key || 'Results'}</h3>
            <p>Showing the completed run. Exports include all result rows.</p>
          </header>
          <div className="report-filter-grid report-no-print">
            <FormInput
              label="Search result rows"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <FormSelect
              label="Result presentation"
              value={presentation.viewMode}
              options={[
                { value: 'table', label: 'Table' },
                { value: 'chart', label: 'Charts' },
              ]}
              onChange={(event) =>
                setPresentation({
                  ...presentation,
                  viewMode: event.target.value as 'table' | 'chart',
                })
              }
            />
          </div>
          {presentation.viewMode === 'chart' ? (
            <>
              <p>
                Charts follow report row order and use the current row search. The table and exports
                retain the exact reported values.
              </p>
              <div
                className="report-metrics report-no-print"
                role="group"
                aria-label="Chart metrics"
              >
                {numeric.map((column) => (
                  <label key={column}>
                    <input
                      type="checkbox"
                      checked={selected.includes(column)}
                      onChange={(event) =>
                        setPresentation({
                          ...presentation,
                          metricColumns: event.target.checked
                            ? [...selected, column]
                            : selected.filter((value) => value !== column),
                        })
                      }
                    />
                    {column}
                  </label>
                ))}
              </div>
              {!numeric.length && (
                <p>No numeric series are available. Choose Table to inspect the rows.</p>
              )}
              <div className="report-chart-grid">
                {selected.map((column) => {
                  const index = table.columns.indexOf(column);
                  const values = table.data
                    .filter((row) =>
                      row.some((cell) => cell.toLowerCase().includes(search.toLowerCase())),
                    )
                    .map((row) => row[index])
                    .filter((value) => value?.trim())
                    .map(Number);
                  return (
                    <article key={column}>
                      <h3>{column}</h3>
                      {values.length ? (
                        <>
                          <MiniTrendLine data={reportChartPoints(values)} width={240} height={80} />
                          {values.length > 200 && (
                            <p>
                              Chart samples 200 of {values.length} matching values, including the
                              first and last.
                            </p>
                          )}
                          <p>
                            {values.length} numeric values · Last{' '}
                            {values.at(-1)?.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          </p>
                        </>
                      ) : (
                        <p>No matching numeric values.</p>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <ResultTable
              key={search}
              title={primary.key || 'Report results'}
              rows={primary.rows}
              search={search}
            />
          )}
        </Card>
      )}
      {!primary.rows.length && !scalars.length && !additional.length && (
        <Card className="report-viewer-section">
          <p>No results were returned for this scope and period.</p>
        </Card>
      )}
      {additional.map(([name, value]) => (
        <details className="report-disclosure" key={name}>
          <summary>{name}</summary>
          <div>
            {Array.isArray(value) &&
            value.length &&
            value.every((row) => row && typeof row === 'object' && !Array.isArray(row)) ? (
              <ResultTable title={name} rows={value} />
            ) : (
              <pre>{JSON.stringify(value, null, 2)}</pre>
            )}
          </div>
        </details>
      ))}
    </>
  );
}
export function ReportEvidence({ result }: { result: ReportExecution }) {
  const { quality, lineage, explanation, manifest } = result;
  return (
    <>
      {!!result.notes.length && (
        <div role="status" className="workspace-notice">
          <p>Some supporting information could not be loaded. Run the report again to retry.</p>
          <ul>
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {quality && (
        <Card className="report-viewer-section report-quality">
          <h3>Data quality</h3>
          {quality.surface && (
            <p>
              {quality.surface.officialUse} · {quality.surface.readinessScore}%{' '}
              {quality.surface.trustStatus}
            </p>
          )}
          {quality.warnings?.length ? (
            <ul>
              {quality.warnings.map((warning, index) => (
                <li key={warning.issueNumber || index}>
                  <strong>
                    {warning.severity ? `${warning.severity}: ` : ''}
                    {warning.title}
                  </strong>
                  <p>{warning.description}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No warning records were returned for this report and scope.</p>
          )}
          {!!quality.surface?.remediationActions?.length && (
            <details>
              <summary>Suggested checks</summary>
              <ul>
                {quality.surface.remediationActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}
      <details className="report-disclosure report-no-print">
        <summary>Explanation and sources</summary>
        <div>
          {explanation && (
            <>
              <p>{explanation.summary}</p>
              <p>{explanation.basis}</p>
              <dl className="report-facts">
                {explanation.drivers?.map((driver) => (
                  <div key={driver.label}>
                    <dt>{driver.label}</dt>
                    <dd>
                      {driver.value}
                      <p>{driver.interpretation}</p>
                    </dd>
                  </div>
                ))}
              </dl>
              {explanation.caveats?.map((caveat) => (
                <p key={caveat}>{caveat}</p>
              ))}
            </>
          )}
          <div className="report-links">
            {[...(lineage?.drillThrough || []), ...(explanation?.recommendedDrillDowns || [])]
              .filter((target) => safeReportLink(target.href))
              .map((target, index) => (
                <WorkspaceLink key={`${target.href}-${index}`} href={target.href}>
                  {target.label}
                </WorkspaceLink>
              ))}
          </div>
          {lineage?.lineage?.map((step, index) => (
            <section key={index}>
              <h3>{step.stage}</h3>
              <p>{step.detail}</p>
            </section>
          ))}
          {lineage && (
            <details>
              <summary>Detailed source information</summary>
              <pre>{JSON.stringify(lineage, null, 2)}</pre>
            </details>
          )}
          {explanation?.explainThisNumber && (
            <details>
              <summary>Calculation explanation</summary>
              <pre>{JSON.stringify(explanation.explainThisNumber, null, 2)}</pre>
            </details>
          )}
          {!lineage && !explanation && (
            <p>Supporting source information is unavailable for this run.</p>
          )}
        </div>
      </details>
      <details className="report-disclosure report-no-print">
        <summary>Run record</summary>
        <div>
          {manifest ? (
            <>
              <p>
                {manifest.status} · {manifest.generatedAt}
              </p>
              <pre>{JSON.stringify(manifest, null, 2)}</pre>
            </>
          ) : (
            <p>
              The report loaded, but its run record was not available. It is not a certified
              snapshot.
            </p>
          )}
        </div>
      </details>
    </>
  );
}
