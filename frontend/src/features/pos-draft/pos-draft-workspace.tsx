'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ClipboardCheck,
  Package,
  ReceiptText,
  History,
  Smartphone,
  RefreshCw,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useDraftScopes } from './use-draft-scopes';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import {
  WorkspaceLink,
  useWorkspacePathname,
  useWorkspaceRouter,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import { backendPatch } from '@/lib/api-client';
import { getDrafts, getDraft, getDraftContext, decideDraft, submitDraft } from './api';
import type { Draft, DraftContext, DraftPage } from './types';
import { KIND_LABELS, STATUS_LABELS, money, submissionEnvelope } from './types';
import { DraftInspector } from './draft-inspector';
import { DraftCapture } from './draft-capture';
import { PosDevices } from './pos-devices';
import './pos-draft.css';

const VIEWS = [
  { id: 'pending', label: 'Pending', icon: ClipboardCheck },
  { id: 'sales', label: 'Sales', icon: ReceiptText },
  { id: 'stock', label: 'Stock', icon: Package },
  { id: 'history', label: 'History', icon: History },
  { id: 'devices', label: 'Devices', icon: Smartphone },
];
export function PosDraftWorkspace() {
  const { hasPermission, loading: authLoading } = useAuth();
  const pathname = useWorkspacePathname();
  const params = useWorkspaceSearchParams();
  const router = useWorkspaceRouter();
  const canReview = hasPermission('pos_drafts.view');
  const canManage = hasPermission('mobile_pos_onboarding.manage');
  const view = !canReview
    ? 'devices'
    : VIEWS.some((item) => item.id === params.get('view'))
      ? params.get('view')!
      : canReview
        ? pathname.startsWith('/pos-draft/stock/')
          ? 'stock'
          : pathname.startsWith('/pos-draft/sales/')
            ? 'sales'
            : 'pending'
        : 'devices';
  const detailId =
    pathname.match(/^\/pos-draft\/(?:requests|sales|stock)\/([^/]+)$/)?.[1] ?? params.get('record');
  const [scope, setScope] = useWorkspaceState<{ companyId: string; branchId: string }>(
    'pos-draft.scope',
    { companyId: '', branchId: '' },
  );
  const [search, setSearch] = useWorkspaceState<string>('pos-draft.search', '');
  const [committedSearch, setCommittedSearch] = useState(search.trim());
  const [status, setStatus] = useWorkspaceState<string>('pos-draft.status', '');
  const [page, setPage] = useWorkspaceState<number>('pos-draft.page', 1);
  const [result, setResult] = useState<DraftPage | null>(null);
  const [selected, setSelected] = useState<Draft | null>(null);
  const [context, setContext] = useState<DraftContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [correcting, setCorrecting] = useState<Draft | undefined>();
  const inspector = useRef<HTMLDivElement>(null);
  const allowed = canReview || canManage;
  const org = useDraftScopes(allowed && !authLoading);
  const lastView = useRef(view);
  useEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    setPage(1);
    setCreating(false);
    setCorrecting(undefined);
  }, [view, setPage]);
  useEffect(() => {
    if (search.trim() === committedSearch) return;
    const timer = setTimeout(() => {
      setPage(1);
      setCommittedSearch(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search, committedSearch, setPage]);
  useEffect(() => {
    if (authLoading || !canReview || view === 'devices') {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void getDrafts(
      {
        ...scope,
        page,
        limit: 25,
        view,
        status: status === 'RETURN_FUNDS' ? undefined : status || undefined,
        attentionRejected: status === 'RETURN_FUNDS' ? true : undefined,
        search: committedSearch || undefined,
      },
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setResult(null);
          setError(e instanceof Error ? e.message : 'Could not load requests.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [authLoading, canReview, view, scope, page, status, committedSearch, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setSelected(null);
    setDetailError('');
    if (detailId && canReview && !authLoading)
      void getDraft(decodeURIComponent(detailId), controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            setSelected(value);
            requestAnimationFrame(() => {
              const pane = inspector.current;
              const frame = pane?.closest('.desktop-window');
              // Restored background details must not take focus from an explicit route.
              if (
                controller.signal.aborted ||
                !pane ||
                (frame &&
                  (frame.getAttribute('data-active') !== 'true' ||
                    frame.getAttribute('aria-hidden') === 'true'))
              )
                return;
              pane.focus();
            });
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setDetailError(e instanceof Error ? e.message : 'Could not open this request.');
        });
    return () => controller.abort();
  }, [detailId, canReview, authLoading, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setContext(null);
    const companyId = selected?.companyId ?? scope.companyId;
    const branchId = selected?.branchId ?? scope.branchId;
    if (companyId && branchId && canReview && !authLoading)
      void getDraftContext({ companyId, branchId }, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setContext(value);
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setDetailError(e instanceof Error ? e.message : 'Could not load branch records.');
        });
    return () => controller.abort();
  }, [scope, selected?.companyId, selected?.branchId, canReview, authLoading]);
  function href(nextView = view) {
    return `/pos-draft?view=${nextView}`;
  }
  function close() {
    router.push(href());
    setCreating(false);
    setCorrecting(undefined);
  }
  function changed(draft: Draft) {
    setSelected(draft);
    setRevision((value) => value + 1);
  }
  const pending = ['SUBMITTED', 'AWAITING_STOCKIST', 'READY_FINAL', 'NEEDS_ATTENTION'];
  const rows = (result?.data ?? []).filter(
    (draft) =>
      (view !== 'pending' ||
        pending.includes(draft.status) ||
        (draft.status === 'REJECTED' && Number(draft.pendingMoney) > 0)) &&
      (view !== 'stock' || !['SALE', 'COLLECTION'].includes(draft.kind)),
  );
  if (!authLoading && !allowed)
    return (
      <div className="pd-app">
        <h1>POS Draft</h1>
        <p role="alert">Your role does not have access to POS requests.</p>
      </div>
    );
  return (
    <div className="pd-app">
      <header className="pd-header">
        <div>
          <span className="pd-eyebrow">POINT OF SALE</span>
          <h1>POS Draft</h1>
          <p>Every request. One clear next step.</p>
        </div>
        <div className="pd-header-actions">
          {view !== 'devices' && (
            <button
              className="pd-icon-button"
              aria-label="Refresh requests"
              disabled={loading}
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw size={18} />
            </button>
          )}
          {context &&
            (context.capabilities.canSubmitSale || context.capabilities.canSubmitStock) &&
            view !== 'devices' && (
              <button
                className="pd-button pd-primary"
                onClick={() => {
                  setCreating(true);
                  setCorrecting(undefined);
                }}
              >
                <Plus size={16} />
                New request
              </button>
            )}
        </div>
      </header>
      <nav className="pd-tabs" aria-label="POS Draft views">
        {VIEWS.filter((item) => (item.id === 'devices' ? canManage : canReview)).map((item) => (
          <WorkspaceLink
            href={href(item.id)}
            key={item.id}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <item.icon size={17} aria-hidden="true" />
            {item.label}
            {item.id === 'pending' && result && (
              <b>
                {result.summary.awaitingApproval +
                  result.summary.awaitingStockist +
                  result.summary.readyFinal}
              </b>
            )}
          </WorkspaceLink>
        ))}
      </nav>
      {view === 'devices' ? (
        <PosDevices />
      ) : (
        <>
          {result && view === 'pending' && (
            <div className="pd-summary">
              <div>
                <span>Pending money</span>
                <strong>{money(result.summary.pendingMoney)}</strong>
              </div>
              <div>
                <span>Awaiting approval</span>
                <strong>{result.summary.awaitingApproval}</strong>
              </div>
              <div>
                <span>Awaiting stockist</span>
                <strong>{result.summary.awaitingStockist}</strong>
              </div>
              <div>
                <span>Ready for final approval</span>
                <strong>{result.summary.readyFinal}</strong>
              </div>
            </div>
          )}
          {org.error && (
            <p className="pd-error" role="alert">
              {org.error}
              <button className="pd-button" onClick={org.retry}>
                Retry branch choices
              </button>
            </p>
          )}
          <div className="pd-filter-bar">
            <label className="pd-field pd-search">
              Search requests
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Customer, person, reference or request"
              />
            </label>
            <label className="pd-field">
              Company
              <select
                value={scope.companyId}
                onChange={(e) => {
                  setScope({ companyId: e.target.value, branchId: '' });
                  setPage(1);
                }}
              >
                <option value="">All accessible companies</option>
                {org.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="pd-field">
              Branch
              <select
                value={scope.branchId}
                disabled={!scope.companyId}
                onChange={(e) => {
                  setScope({ ...scope, branchId: e.target.value });
                  setPage(1);
                }}
              >
                <option value="">All accessible branches</option>
                {org.branches
                  .filter((branch) => branch.companyId === scope.companyId)
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="pd-field">
              Status
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">
                  {view === 'history' ? 'Posted and rejected' : 'All statuses'}
                </option>
                <option value="RETURN_FUNDS">Rejected · funds to return</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && (
            <p className="pd-error" role="alert">
              {error}
              <button className="pd-button" onClick={() => setRevision((value) => value + 1)}>
                Try again
              </button>
            </p>
          )}
          <div
            className={`pd-review-layout ${selected || detailId || creating ? 'pd-has-detail' : ''}`}
          >
            <section className="pd-request-list" aria-label="POS requests">
              {loading ? (
                <div className="pd-empty" role="status">
                  Loading requests…
                </div>
              ) : rows.length ? (
                rows.map((draft) => (
                  <WorkspaceLink
                    className="pd-request-row"
                    key={draft.id}
                    href={`/pos-draft/${['SALE', 'COLLECTION'].includes(draft.kind) ? 'sales' : 'stock'}/${encodeURIComponent(draft.id)}?view=${view}`}
                    aria-current={selected?.id === draft.id ? 'true' : undefined}
                  >
                    <span className="pd-request-icon">
                      {['SALE', 'COLLECTION'].includes(draft.kind) ? (
                        <ReceiptText size={20} />
                      ) : (
                        <Package size={20} />
                      )}
                    </span>
                    <span className="pd-request-title">
                      <strong>{KIND_LABELS[draft.kind]}</strong>
                      <small>
                        {draft.branch?.name ??
                          org.branches.find((branch) => branch.id === draft.branchId)?.name ??
                          'Assigned branch'}{' '}
                        · {draft.businessDate} · {draft.originRole.toLowerCase()}
                      </small>
                      <span className="pd-status" data-status={draft.status}>
                        {STATUS_LABELS[draft.status] ?? draft.status}
                        {draft.status === 'REJECTED' && Number(draft.pendingMoney) > 0
                          ? ' · funds to return'
                          : ''}
                      </span>
                    </span>
                    <span className="pd-request-amount">
                      {draft.amount != null && money(draft.amount, draft.currency)}
                      <ChevronRight size={16} />
                    </span>
                  </WorkspaceLink>
                ))
              ) : (
                !error && (
                  <div className="pd-empty">
                    <ClipboardCheck size={28} />
                    <h2>No requests in this view</h2>
                    <p>
                      {view === 'pending'
                        ? 'New submissions will appear here for review.'
                        : 'Try another branch or status.'}
                    </p>
                  </div>
                )
              )}
              {result && result.total > result.limit && (
                <div className="pd-pagination">
                  <button
                    className="pd-button"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <span>Page {page}</span>
                  <button
                    className="pd-button"
                    disabled={page * result.limit >= result.total || loading}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
            {(selected || detailId || creating) && (
              <div ref={inspector} tabIndex={-1} className="pd-detail-pane">
                {detailError && (
                  <p className="pd-error" role="alert">
                    {detailError}
                  </p>
                )}
                {creating && context ? (
                  <>
                    <button className="pd-button" onClick={close}>
                      Close capture
                    </button>
                    <DraftCapture
                      context={context}
                      role="ADMIN"
                      initial={correcting}
                      send={(body, initial) =>
                        initial
                          ? backendPatch<Draft>(`/pos-drafts/${initial.id}/correct`, {
                              ...submissionEnvelope(body),
                              revision: initial.revision,
                            })
                          : submitDraft(body)
                      }
                      onSaved={(draft) => {
                        setCreating(false);
                        setCorrecting(undefined);
                        setRevision((value) => value + 1);
                        router.push(`/pos-draft/requests/${draft.id}?view=${view}`);
                      }}
                    />
                  </>
                ) : selected ? (
                  <DraftInspector
                    key={`${selected.id}:${selected.revision}`}
                    draft={selected}
                    context={context}
                    decide={decideDraft}
                    onChanged={changed}
                    onClose={close}
                    onCorrect={(draft) => {
                      setCorrecting(draft);
                      setCreating(true);
                    }}
                  />
                ) : (
                  !detailError && (
                    <div role="status" className="pd-empty">
                      Opening request…
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
