'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, FileText, RefreshCw, X } from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import { useWorkspaceState } from './workspace-session';
import './workspace.css';

export interface RecordField<T> {
  label: string;
  value: (record: T) => ReactNode;
}
interface Props<T extends { id: string }> {
  records: T[];
  title: string;
  name: (record: T) => string;
  reference?: (record: T) => string;
  decoration?: (record: T) => ReactNode;
  status?: (record: T) => string;
  fields: RecordField<T>[];
  details?: RecordField<T>[];
  actions?: (record: T) => ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: string;
  page?: number;
  total?: number;
  pageSize?: number;
  onPage?: (page: number) => void;
  stateKey?: string;
  selectionScope?: string;
}

/** One list/inspector pattern for business records. Selection never mutates a record. */
export function RecordBrowser<T extends { id: string }>({
  records,
  title,
  name,
  reference,
  decoration,
  status,
  fields,
  details = [],
  actions,
  loading,
  error,
  onRetry,
  empty = 'No records match this view.',
  page = 1,
  total = records.length,
  pageSize = 20,
  onPage,
  stateKey,
  selectionScope,
}: Props<T>) {
  const [selection, setSelection] = useWorkspaceState<{ id: string | null; scope?: string } | null>(
    stateKey,
    null,
  );
  const selectedId = selection?.scope === selectionScope ? selection?.id : null;
  const setSelectedId = (id: string | null) => setSelection({ id, scope: selectionScope });
  const prefix = useId();
  const selected = !loading && !error ? records.find((row) => row.id === selectedId) : undefined;
  const inspector = useRef<HTMLElement>(null);
  const resolvedId = selected?.id;
  const focusRequest = useRef({ selection: selectedId, handled: false });
  useEffect(() => {
    if (focusRequest.current.selection !== selectedId)
      focusRequest.current = { selection: selectedId, handled: false };
    if (!resolvedId || focusRequest.current.handled) return;
    focusRequest.current.handled = true;
    const pane = inspector.current?.closest('.os-workspace-pane');
    if (pane?.getAttribute('data-os-active') === 'false') return;
    const paneWidth = pane?.getBoundingClientRect().width;
    const narrow = paneWidth ? paneWidth <= 1000 : window.matchMedia('(max-width: 1000px)').matches;
    if (narrow) inspector.current?.focus();
  }, [resolvedId, selectedId]);
  function close() {
    const id = selectedId;
    setSelectedId(null);
    requestAnimationFrame(() => document.getElementById(`${prefix}-inspect-${id}`)?.focus());
  }
  return (
    <div className={`record-browser ${selected ? 'record-selected' : ''}`}>
      <section className="record-list" aria-label={title}>
        <div className="record-list-heading">
          <span>{title}</span>
          <span>
            {loading ? 'Loading…' : error ? 'Unavailable' : `${total.toLocaleString()} records`}
          </span>
        </div>
        {loading ? (
          <div role="status" className="record-empty">
            <RefreshCw size={23} className="animate-spin" />
            <h2>Loading records</h2>
          </div>
        ) : error ? (
          <div role="alert" className="record-empty">
            <FileText size={30} />
            <h2>Unable to load records</h2>
            <p>{error}</p>
            {onRetry && <button onClick={onRetry}>Try again</button>}
          </div>
        ) : records.length === 0 ? (
          <div className="record-empty">
            <FileText size={32} strokeWidth={1.3} />
            <h2>Nothing here yet</h2>
            <p>{empty}</p>
          </div>
        ) : (
          <div className="record-table-scroll">
            <table className="record-table">
              <thead>
                <tr>
                  <th scope="col">{title === 'Companies' ? 'Company' : 'Record'}</th>
                  {fields.slice(0, 2).map((f) => (
                    <th scope="col" key={f.label}>
                      {f.label}
                    </th>
                  ))}
                  {status && <th scope="col">Status</th>}
                  <th scope="col">
                    <span className="sr-only">Open details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((row) => (
                  <tr
                    key={row.id}
                    data-selected={selectedId === row.id}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <td>
                      <button
                        id={`${prefix}-inspect-${row.id}`}
                        aria-label={`Inspect ${name(row)}`}
                        aria-expanded={selectedId === row.id}
                        onClick={() => setSelectedId(row.id)}
                      >
                        {decoration ? (
                          <span className="record-identity">
                            {decoration(row)}
                            <span>
                              <strong>{name(row)}</strong>
                              {reference && <small>{reference(row)}</small>}
                            </span>
                          </span>
                        ) : (
                          <>
                            <strong>{name(row)}</strong>
                            {reference && <small>{reference(row)}</small>}
                          </>
                        )}
                      </button>
                    </td>
                    {fields.slice(0, 2).map((f) => (
                      <td key={f.label}>{f.value(row)}</td>
                    ))}
                    {status && (
                      <td>
                        <StatusBadge value={status(row)} />
                      </td>
                    )}
                    <td>
                      <ChevronRight size={14} aria-hidden />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {onPage && !error && total > pageSize && (
          <footer className="record-pagination">
            <span>
              Page {page} of {Math.ceil(total / pageSize)}
            </span>
            <button
              disabled={loading || page <= 1}
              onClick={() => {
                setSelectedId(null);
                onPage(page - 1);
              }}
            >
              Previous
            </button>
            <button
              disabled={loading || page * pageSize >= total}
              onClick={() => {
                setSelectedId(null);
                onPage(page + 1);
              }}
            >
              Next
            </button>
          </footer>
        )}
      </section>
      <aside
        className="record-inspector"
        aria-label="Record details"
        ref={inspector}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        {selected && !loading && !error ? (
          <>
            <button className="record-mobile-back" onClick={close}>
              <ArrowLeft size={15} /> Back to list
            </button>
            <header>
              <span className="record-document">
                {decoration ? decoration(selected) : <FileText size={23} strokeWidth={1.4} />}
              </span>
              <button aria-label="Close details" onClick={close}>
                <X size={17} />
              </button>
            </header>
            <h2>{name(selected)}</h2>
            {reference && <p className="record-reference">{reference(selected)}</p>}
            {status && <StatusBadge value={status(selected)} />}
            <dl>
              {[...fields, ...details].map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value(selected) ?? '—'}</dd>
                </div>
              ))}
            </dl>
            {actions && <div className="record-actions">{actions(selected)}</div>}
          </>
        ) : (
          <div className="record-empty">
            <FileText size={31} strokeWidth={1.3} />
            <h2>Everything in view.</h2>
            <p>Select a record to review its details and next steps.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
