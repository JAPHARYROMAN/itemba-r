'use client';
import { useEffect, useRef, useState } from 'react';
import { printWorkspace } from '@/components/workspace/print-workspace';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { DocumentExportButton } from '@/components/documents/DocumentExportButton';
import { downloadTextFile, toCsv } from '@/lib/report-export';
import { money } from '@/features/invoice-desk/types';
import { expenseCategories, movementLabels } from '@/features/cash-desk/types';
import type { AnalysisRow, AnalysisTable } from './analysis-types';
export const csvSafe = (value: string) =>
  /^[\s]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
export function analysisCsv(
  table: AnalysisTable,
  rows = table.rows,
  metadata: Record<string, string> = {},
) {
  return (
    '\uFEFF' +
    toCsv(
      ['Report', csvSafe(table.title)],
      Object.entries(metadata).map(([key, value]) => [key, csvSafe(value)]),
    ) +
    '\r\n\r\n' +
    toCsv(
      table.columns.map((c) => c.label),
      rows.map((row) => table.columns.map((c) => csvSafe(String(row[c.key] ?? '')))),
    )
  );
}
export function readableCell(key: string, value: string | number) {
  const raw = String(value ?? '');
  return key === 'category' || key === 'name'
    ? (expenseCategories[raw] ?? (raw === 'UNCATEGORIZED' ? 'Uncategorised' : raw))
    : key === 'kind'
      ? (movementLabels[raw] ?? raw)
      : raw;
}
export function AnalysisGrid({
  table,
  onDrill,
  onDocument,
  caption,
  metadata = {},
  rowLink,
  companyId,
}: {
  table: AnalysisTable;
  companyId?: string;
  onDrill?: (row: AnalysisRow) => void;
  onDocument?: (id: string) => void;
  caption: string;
  metadata?: Record<string, string>;
  rowLink?: (row: AnalysisRow) => string;
}) {
  const surface = useRef<HTMLElement>(null);
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null),
    [printing, setPrinting] = useState(false);
  const filtered = table.rows.filter((r) =>
    table.columns.some((c) =>
      readableCell(c.key, r[c.key]).toLowerCase().includes(search.toLowerCase()),
    ),
  );
  const sorted = sort
    ? [...filtered].sort((a, b) => {
        const c = table.columns.find((c) => c.key === sort.key)!;
        const av = a[sort.key],
          bv = b[sort.key];
        let result: number;
        if (c.money) {
          const cents = (v: string | number) => {
            const text = String(v),
              negative = text.startsWith('-'),
              [whole, fraction = ''] = text.replace('-', '').split('.');
            return (
              BigInt(whole || '0') * 100n * (negative ? -1n : 1n) +
              BigInt(fraction.padEnd(2, '0').slice(0, 2)) * (negative ? -1n : 1n)
            );
          };
          const x = cents(av),
            y = cents(bv);
          result = x < y ? -1 : x > y ? 1 : 0;
        } else result = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sort.desc ? -result : result;
      })
    : filtered;
  const pages = Math.max(1, Math.ceil(sorted.length / 25)),
    current = Math.min(page, pages),
    visible = printing ? sorted : sorted.slice((current - 1) * 25, current * 25);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const frame = requestAnimationFrame(() => printWorkspace(surface.current));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);
  return (
    <section className="analysis-grid" ref={surface}>
      <div className="analysis-table-toolbar">
        <div>
          <h2>{table.title}</h2>
          <p>
            {sorted.length.toLocaleString()} of {table.rows.length.toLocaleString()} rows ·{' '}
            {caption}
          </p>
        </div>
        <div className="reports-actions">
          <input
            type="search"
            aria-label="Search report results"
            value={search}
            placeholder="Search results…"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <DocumentExportButton
            table={{
              title: table.title,
              companyId,
              subtitle: caption,
              orientation: table.columns.length > 5 ? 'landscape' : 'portrait',
              numericColumns: table.columns.flatMap((column, index) =>
                column.money ? [index] : [],
              ),
              columns: table.columns.map((column) => column.label),
              rows: sorted.map((row) =>
                table.columns.map((column) => readableCell(column.key, row[column.key])),
              ),
              meta: Object.entries({
                Scope: caption,
                ...metadata,
                'Result filter': search || 'All rows',
              })
                .slice(0, 12)
                .map(([label, value]) => ({
                  label: label.slice(0, 60),
                  value: value.slice(0, 200),
                })),
            }}
          />
          <button
            disabled={!sorted.length}
            onClick={() =>
              downloadTextFile(
                `${table.id}.csv`,
                'text/csv;charset=utf-8',
                analysisCsv(table, sorted, {
                  Scope: caption,
                  ...metadata,
                  'Result filter': search || 'All rows',
                }),
              )
            }
          >
            Export CSV
          </button>
          <button disabled={!sorted.length} onClick={() => setPrinting(true)}>
            Print / PDF
          </button>
        </div>
      </div>
      {search && <p className="reports-scope-summary">Results matching “{search}”</p>}
      {!sorted.length ? (
        <div className="reports-empty">
          <h3>No matching records</h3>
          <p>
            Adjust the period or filters. New records will appear when entered in the source app.
          </p>
        </div>
      ) : (
        <div className="reports-table-wrap" role="region" aria-label={table.title} tabIndex={0}>
          <table>
            <caption className="sr-only">{table.title}</caption>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      sort?.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'
                    }
                  >
                    <button
                      className="analysis-sort"
                      onClick={() =>
                        setSort((s) => ({ key: c.key, desc: s?.key === c.key ? !s.desc : false }))
                      }
                    >
                      {c.label}
                      {sort?.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
                {(onDrill || onDocument || rowLink) && (
                  <th scope="col" className="analysis-no-print">
                    Explore
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={`${r.id ?? r.month}-${r.currency}-${i}`}>
                  {table.columns.map((c) => (
                    <td key={c.key} className={c.money ? 'reports-number' : ''}>
                      {c.money
                        ? r[c.key] === ''
                          ? 'Unavailable'
                          : money(String(r[c.key] ?? '0'))
                        : readableCell(c.key, r[c.key]) || '—'}
                    </td>
                  ))}
                  {(onDrill || onDocument || rowLink) && (
                    <td className="analysis-no-print">
                      {rowLink?.(r) && <Link href={rowLink(r)}>Open source</Link>}
                      {onDrill && (
                        <button onClick={() => onDrill(r)}>
                          {table.id === 'branches' ? 'View branch' : 'View statement'}
                        </button>
                      )}
                      {onDocument && (
                        <button onClick={() => onDocument(String(r.documentId ?? r.id))}>
                          Open invoice
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sorted.length > 25 && (
        <nav className="reports-pagination" aria-label="Report pages">
          <button disabled={current === 1} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span>
            Page {current} of {pages}
          </span>
          <button disabled={current === pages} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </nav>
      )}
      <p className="reports-footnote">
        Export and Print / PDF include all {sorted.length.toLocaleString()} matching rows in this
        table, in the selected sort order.
      </p>
    </section>
  );
}
