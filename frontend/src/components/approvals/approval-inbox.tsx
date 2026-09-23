'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { FormInput, FormSelect, PageToolbar, PermissionDeniedState, Btn } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { ApprovalRequestInspector } from './approval-request-inspector';
import {
  type ApprovalRequest,
  requestPath,
  requestStatuses,
  requestTitle,
  requestPerson,
  requestAmount,
} from './approval-request-types';
import '../workspace/workspace.css';
import './approval-inbox.css';

export function ApprovalInbox({ mode = 'pending' }: { mode?: 'pending' | 'all' }) {
  const { hasPermission, loading: authLoading } = useAuth();
  const allowed = hasPermission('approval_requests.view'),
    canChoose = hasPermission('companies.read');
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [filters, setFilters] = useState({ companyId: '', entityType: '', status: '' });
  const [selection, setSelection] = useState<{ id: string; key: string } | null>(null),
    [notice, setNotice] = useState('');
  const inspector = useRef<HTMLElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const params = {
    page,
    limit: 15,
    search: query,
    companyId: filters.companyId,
    entityType: filters.entityType,
    ...(mode === 'all' ? { status: filters.status } : {}),
  };
  const key = JSON.stringify([mode, params]);
  const result = useWorkspaceResource<{ data: ApprovalRequest[]; total: number }>(
    mode === 'all' ? requestPath : requestPath + '/pending/me',
    params,
    allowed && !authLoading,
  );
  const companies = useWorkspaceChoices<{ id: string; name: string }>(
    '/companies',
    {},
    allowed && !authLoading && canChoose,
  );
  const items = result.data?.data || [],
    total = result.data?.total || 0;
  const selected =
    !result.loading && !result.error && selection?.key === key
      ? items.find((r) => r.id === selection.id)
      : undefined;
  useEffect(() => {
    if (result.data && page > 1 && !result.data.data.length) setPage((p) => p - 1);
  }, [result.data, page]);
  useEffect(() => {
    if (selected && window.matchMedia('(max-width: 850px)').matches) inspector.current?.focus();
  }, [selected]);
  const close = () => {
    const id = selected?.id;
    setSelection(null);
    requestAnimationFrame(() => document.getElementById(`approval-${id}`)?.focus());
  };
  const change = (name: keyof typeof filters, value: string) => {
    setFilters((previous) => ({ ...previous, [name]: value }));
    setPage(1);
  };
  const saved = (message: string) => {
    setNotice(message);
    setSelection(null);
    result.reload();
  };
  if (!authLoading && !allowed)
    return (
      <div className="p-8">
        <PermissionDeniedState
          title="Approvals are not available to your role"
          description="Contact your administrator for access to approval requests."
        />
      </div>
    );
  const filtered =
    !!query || !!filters.companyId || !!filters.entityType || (mode === 'all' && !!filters.status);
  return (
    <div className={`approval-inbox ${selected ? 'has-selection' : ''}`}>
      <section
        className="approval-list-pane"
        aria-label={mode === 'all' ? 'All requests' : 'Pending requests'}
      >
        <header className="approval-heading">
          <div>
            <h1>{mode === 'all' ? 'Approval requests' : 'Approvals'}</h1>
            <p>
              {mode === 'all'
                ? 'Review requests, decisions and their history.'
                : 'Review what needs your attention.'}
            </p>
          </div>
          <button
            onClick={result.reload}
            disabled={result.loading || authLoading}
            aria-label="Refresh approvals"
          >
            <RefreshCw size={16} className={result.loading ? 'animate-spin' : ''} />
          </button>
        </header>
        <nav className="approval-tabs" aria-label="Approval views">
          {mode === 'pending' ? (
            <>
              <span aria-current="page">
                Pending {!result.loading && !result.error && <b>{total}</b>}
              </span>
              <Link href="/approvals/requests">
                All requests <ArrowRight size={13} />
              </Link>
            </>
          ) : (
            <>
              <Link href="/approvals/pending">
                Pending <ArrowRight size={13} />
              </Link>
              <span aria-current="page">
                All requests {!result.loading && !result.error && <b>{total}</b>}
              </span>
            </>
          )}
        </nav>
        <div className="approval-filter-bar">
          {notice && (
            <p className="workspace-notice" role="status">
              {notice}
            </p>
          )}
          {companies.error && (
            <div className="workspace-notice" role="alert">
              {companies.error}
              <Btn variant="ghost" onClick={companies.retry}>
                Retry companies
              </Btn>
            </div>
          )}
          <PageToolbar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search requests, references or people…"
            collapsibleFilters
            activeFilterCount={Object.values(filters).filter(Boolean).length}
            filters={
              <>
                {canChoose && (
                  <FormSelect
                    label="Company filter"
                    value={filters.companyId}
                    onChange={(e) => change('companyId', e.target.value)}
                    placeholder="All accessible companies"
                    options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
                    disabled={companies.loading || !!companies.error}
                  />
                )}
                <FormInput
                  label="Entity type filter"
                  value={filters.entityType}
                  onChange={(e) => change('entityType', e.target.value)}
                  placeholder="Exact entity type"
                />
                {mode === 'all' && (
                  <FormSelect
                    label="Status filter"
                    value={filters.status}
                    onChange={(e) => change('status', e.target.value)}
                    placeholder="All statuses"
                    options={requestStatuses.map((value) => ({
                      value,
                      label: value[0] + value.slice(1).toLowerCase(),
                    }))}
                  />
                )}
              </>
            }
          />
        </div>
        <div className="approval-columns">
          <span>Request</span>
          <span>Company / requester</span>
          <span>Amount</span>
        </div>
        {result.loading || authLoading ? (
          <div className="approval-empty" role="status">
            <RefreshCw className="animate-spin" size={22} />
            <h2>Loading your requests</h2>
          </div>
        ) : result.error ? (
          <div className="approval-empty" role="alert">
            <FileText size={28} />
            <h2>Requests couldn’t be loaded</h2>
            <p>{result.error}</p>
            <button onClick={result.reload}>Try again</button>
          </div>
        ) : !items.length ? (
          <div className="approval-empty">
            <span className="approval-empty-icon">
              <CheckCheck size={30} strokeWidth={1.5} />
            </span>
            <h2>
              {mode === 'pending' && !filtered ? 'You’re all caught up.' : 'No matching requests.'}
            </h2>
            <p>
              {mode === 'pending' && !filtered
                ? 'Requests that need your approval will appear here.'
                : 'Try another search or filter.'}
            </p>
            {mode === 'pending' && (
              <Link href="/approvals/requests">
                Browse all requests <ArrowRight size={14} />
              </Link>
            )}
          </div>
        ) : (
          <ul className="approval-rows">
            {items.map((row) => (
              <li key={row.id}>
                <button
                  id={`approval-${row.id}`}
                  className={row.id === selected?.id ? 'selected' : ''}
                  onClick={() => setSelection({ id: row.id, key })}
                  aria-pressed={row.id === selected?.id}
                >
                  <span className="approval-request">
                    <span className="approval-document">
                      <FileText size={20} strokeWidth={1.4} />
                    </span>
                    <span>
                      <strong>{requestTitle(row)}</strong>
                      <small>
                        {row.approvalRequestNumber || 'No reference'}
                        {mode === 'all'
                          ? ` · ${row.status?.toLowerCase() || 'Unknown status'}`
                          : ''}
                      </small>
                    </span>
                  </span>
                  <span className="approval-requester">
                    {row.company?.name || row.companyId || 'Group-level'}
                    <small>{requestPerson(row)}</small>
                  </span>
                  <span className="approval-amount">{requestAmount(row)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!result.loading && !result.error && total > 0 && (
          <footer className="approval-pagination">
            <span>
              {(page - 1) * 15 + 1}–{Math.min(page * 15, total)} of {total}
            </span>
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous requests"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={page * 15 >= total}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next requests"
            >
              <ChevronRight size={16} />
            </button>
          </footer>
        )}
      </section>
      <aside
        ref={inspector}
        tabIndex={-1}
        className="approval-inspector"
        aria-label="Request details"
      >
        {selected ? (
          <ApprovalRequestInspector
            key={selected.id}
            row={selected}
            onClose={close}
            onSaved={saved}
          />
        ) : (
          <div className="approval-detail-placeholder">
            <FileText size={32} strokeWidth={1.2} />
            <h2>A clear view of every request.</h2>
            <p>Select a request to see the details and take the next step.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
