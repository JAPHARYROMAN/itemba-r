'use client';

import { useEffect, useRef, useState } from 'react';
import { amount, type Report } from '@/components/fuel-reporting/types';
import { StatusBadge, WorkspaceTable } from '@/components/ui';
import { backendGet } from '@/lib/api-client';

const PAGE_SIZE = 50;

export function PetroDollarHistory({
  branchId,
  onOpen,
}: {
  branchId: string;
  onOpen: (report: Report) => void;
}) {
  const [rows, setRows] = useState<Report[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const scope = useRef<AbortController | null>(null);
  const pagingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    const { signal } = controller;
    backendGet<Report[]>('/petrodollar/history', { query: { branchId }, signal })
      .then((page) => {
        if (signal.aborted) return;
        setRows(page);
        setHasMore(page.length === PAGE_SIZE);
      })
      .catch((e) => {
        if (!signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load report history.');
      });
    return () => controller.abort();
  }, [branchId, retry]);

  async function loadOlder() {
    const signal = scope.current?.signal;
    const before = rows?.at(-1)?.id;
    if (!signal || signal.aborted || !before || !hasMore || pagingRef.current) return;
    pagingRef.current = true;
    setPaging(true);
    setError('');
    try {
      const page = await backendGet<Report[]>('/petrodollar/history', {
        query: { branchId, before },
        signal,
      });
      if (signal.aborted) return;
      const seen = new Set(rows?.map((report) => report.id));
      const older = page.filter((report) => !seen.has(report.id));
      setRows((current) => [...(current ?? []), ...older]);
      setHasMore(page.length === PAGE_SIZE && older.length > 0);
    } catch (e) {
      if (!signal.aborted)
        setError(e instanceof Error ? e.message : 'Could not load older reports.');
    } finally {
      if (!signal.aborted) {
        pagingRef.current = false;
        setPaging(false);
      }
    }
  }

  if (!rows)
    return error ? (
      <p role="alert" className="desk-error">
        {error}{' '}
        <button
          type="button"
          onClick={() => {
            setError('');
            setRetry((attempt) => attempt + 1);
          }}
        >
          Retry history
        </button>
      </p>
    ) : (
      <p role="status" className="desk-loading">
        Loading report history…
      </p>
    );

  if (!rows.length)
    return <p className="desk-empty">No reports have been saved for this station yet.</p>;

  return (
    <div className="pd-history">
      <WorkspaceTable label="Report history">
        <thead>
          <tr>
            <th>Business date</th>
            <th>Shift</th>
            <th>Status</th>
            <th>Sales · TZS</th>
            <th>Differences</th>
            <th>Revision</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.businessDate.slice(0, 10)}</td>
              <td>{r.shift === 'DAY' ? 'Day' : 'Night'}</td>
              <td>
                <StatusBadge status={r.status === 'CLOSED' ? 'CLOSED' : 'DRAFT'} />
              </td>
              <td className="pd-number">{amount(r.summary.sales)}</td>
              <td>{r.summary.flagged}</td>
              <td>{r.version}</td>
              <td>
                <button type="button" className="desk-text-button" onClick={() => onOpen(r)}>
                  Open report →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </WorkspaceTable>
      {error && (
        <p role="alert" className="desk-error">
          {error}
        </p>
      )}
      {hasMore && (
        <div className="desk-pagination">
          <button type="button" disabled={paging} onClick={() => void loadOlder()}>
            {paging
              ? 'Loading older reports…'
              : error
                ? 'Retry loading older reports'
                : 'Load older reports'}
          </button>
          {paging && (
            <span role="status" className="sr-only">
              Loading older reports…
            </span>
          )}
        </div>
      )}
    </div>
  );
}
