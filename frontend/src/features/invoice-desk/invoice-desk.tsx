'use client';
import { useDeferredValue, useRef, useState } from 'react';
import Link from 'next/link';
import { FilePreviewDialog } from '@/components/documents/FilePreviewDialog';
import type { FilePreviewSource } from '@/components/documents/file-preview-source';
import { AppGlyph } from '@/components/os/app-glyph';
import { notifyDeskSaved, useLinkedDeskChanges } from '@/components/workspace/linked-desk-changes';
import { getApp } from '@/lib/apps';
import { useDeskRecordSelection } from '@/components/workspace/desk-record-selection';
import { useDeskSection } from '@/components/workspace/use-desk-section';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { WorkspaceDraftShelf, type WorkspaceDraft } from '@/components/workspace/workspace-drafts';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileText,
  LayoutDashboard,
  Paperclip,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Users,
  Wallet,
} from 'lucide-react';
import { Btn, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendGet, backendUpload } from '@/lib/api-client';
import { DeskEditor } from './desk-editor';
import { Directory, Invoice, Overview, Scope, Supplier, dateLabel, money } from './types';
import './invoice-desk.css';

const emptyDirectory: Directory = { companies: [], divisions: [], branches: [] };
type Editor = {
  draftId?: string;
  needsReview?: boolean;
  kind: 'invoice' | 'edit' | 'supplier' | 'payment' | 'void' | 'reverse';
  invoice?: Invoice;
  paymentId?: string;
};
const deskApp = getApp('invoice-desk')!;
const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'suppliers', label: 'Suppliers', icon: Users },
] as const;

export function InvoiceDesk({ targetRecordId }: { targetRecordId?: string } = {}) {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('invoice_desk.view'),
    manage = hasPermission('invoice_desk.manage'),
    payments = hasPermission('invoice_desk.payments');
  const [section, setSection] = useDeskSection('invoice-desk', [
    'overview',
    'invoices',
    'suppliers',
  ] as const);
  const [scope, setScope] = useWorkspaceState<Scope>('invoice-desk.scope', {
    companyId: '',
    divisionId: '',
    branchId: '',
  });
  const [status, setStatus] = useWorkspaceState('invoice-desk.status', 'all'),
    [search, setSearch] = useWorkspaceState('invoice-desk.search', ''),
    [page, setPage] = useWorkspaceState('invoice-desk.page', 1),
    [supplierId, setSupplierId] = useWorkspaceState('invoice-desk.supplierId', '');
  const [currency, setCurrency] = useWorkspaceState('invoice-desk.currency', ''),
    [selected, setSelected] = useDeskRecordSelection('invoice-desk', targetRecordId),
    [editor, setEditor] = useState<Editor | null>(null),
    [notice, setNotice] = useState('');
  const deferredSearch = useDeferredValue(search);
  const directory = useWorkspaceResource<Directory>('/invoice-desk/directory', {}, allowed);
  const query = Object.fromEntries(Object.entries(scope).filter(([, v]) => v));
  const overview = useWorkspaceResource<Overview>('/invoice-desk/overview', query, allowed);
  const invoices = useWorkspaceResource<{
    rows: Invoice[];
    total: number;
    page: number;
    pageSize: number;
  }>(
    '/invoice-desk/invoices',
    {
      ...query,
      status: section === 'overview' ? 'overdue' : status,
      search: section === 'overview' ? '' : deferredSearch,
      supplierId: section === 'overview' ? '' : supplierId,
      page: section === 'overview' ? 1 : page,
    },
    allowed && section !== 'suppliers',
  );
  const suppliers = useWorkspaceResource<Supplier[]>(
    '/invoice-desk/suppliers',
    { ...(scope.companyId ? { companyId: scope.companyId } : {}), search: deferredSearch },
    allowed && section === 'suppliers',
  );
  const detail = useWorkspaceResource<Invoice>(
    `/invoice-desk/invoices/${encodeURIComponent(selected)}`,
    {},
    allowed && !!selected,
  );
  const dir = directory.data ?? emptyDirectory;
  const activeCurrency =
    overview.data?.currencies.find((c) => c.currency === currency) ?? overview.data?.currencies[0];
  const invoice = detail.data;
  const rows = invoices.data?.rows ?? [];
  function reload() {
    overview.reload();
    invoices.reload();
    suppliers.reload();
    detail.reload();
  }
  useLinkedDeskChanges('invoice-desk', !!editor, reload);
  function changeScope(key: keyof Scope, value: string) {
    setScope((s) => ({
      ...s,
      [key]: value,
      ...(key === 'companyId'
        ? { divisionId: '', branchId: '' }
        : key === 'divisionId'
          ? { branchId: '' }
          : {}),
    }));
    setPage(1);
    setSelected('');
    setSupplierId('');
  }
  function go(view: typeof section) {
    setSection(view);
    setSearch('');
    setPage(1);
    setSupplierId('');
  }
  function filtered(value: string) {
    go('invoices');
    setStatus(value);
  }
  function saved(id?: string) {
    const kind = editor?.kind;
    setEditor(null);
    reload();
    notifyDeskSaved('invoice-desk');
    setNotice(
      kind === 'invoice'
        ? 'Invoice saved.'
        : kind === 'supplier'
          ? 'Supplier saved.'
          : kind === 'payment'
            ? 'Payment recorded.'
            : 'Record updated.',
    );
    if (id) setSelected(id);
  }
  async function resumeDraft(draft: WorkspaceDraft) {
    const kind = draft.context.kind as Editor['kind'];
    if (!['invoice', 'edit', 'supplier', 'payment', 'void', 'reverse'].includes(kind))
      throw new Error('This draft cannot be opened in Invoice Desk.');
    if (['payment', 'reverse'].includes(kind) ? !payments : !manage)
      throw new Error('Your role cannot continue this draft.');
    const invoice = draft.context.invoiceId
      ? await backendGet<Invoice>(
          `/invoice-desk/invoices/${encodeURIComponent(draft.context.invoiceId)}`,
        )
      : undefined;
    setEditor({
      kind,
      invoice,
      paymentId: draft.context.paymentId || undefined,
      draftId: draft.id,
      needsReview: !!invoice && String(invoice.version) !== draft.context.version,
    });
  }
  if (!allowed)
    return (
      <div className="invoice-desk desk-denied">
        <Receipt size={36} />
        <h1>Invoice Desk</h1>
        <p>
          You need Invoice Desk access to open this app. Ask your administrator to grant it to your
          role.
        </p>
      </div>
    );
  return (
    <div className="invoice-desk">
      <aside className="desk-rail">
        <div className="desk-identity">
          <AppGlyph app={deskApp} size="medium" />
          <div>
            <strong>Invoice Desk</strong>
            <span>Your purchase companion</span>
          </div>
        </div>
        <nav aria-label="Invoice Desk">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={section === id ? 'page' : undefined}
              onClick={() => go(id)}
            >
              <Icon size={18} />
              {label}
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="desk-rail-note">
          <span className="desk-note-icon">
            <Check size={16} />
          </span>
          <strong>A clear picture of what you owe.</strong>
          <p>Keep purchases and payments together, from the first invoice to the final balance.</p>
        </div>
        <div className="desk-os-label">MADE FOR ITEMBA OS</div>
      </aside>
      <div className="desk-main">
        <header className="desk-header">
          <div>
            <p className="desk-eyebrow">YOUR PURCHASES, IN VIEW</p>
            <h1>{sections.find((s) => s.id === section)?.label}</h1>
            <p>
              {section === 'overview'
                ? 'A little clarity for every commitment.'
                : section === 'invoices'
                  ? 'Every invoice, from received to paid.'
                  : 'The people and businesses you buy from.'}
            </p>
          </div>
          <div className="desk-header-actions">
            <button
              className="desk-icon-button"
              aria-label="Refresh Invoice Desk"
              onClick={() => {
                directory.reload();
                reload();
              }}
            >
              <RefreshCw size={17} />
            </button>
            {manage && (
              <Btn
                icon={<Plus size={16} />}
                onClick={() =>
                  setEditor({ kind: section === 'suppliers' ? 'supplier' : 'invoice' })
                }
              >
                {section === 'suppliers' ? 'New supplier' : 'New invoice'}
              </Btn>
            )}
          </div>
        </header>
        <WorkspaceDraftShelf
          appId="invoice-desk"
          onResume={resumeDraft}
          activeDraftId={editor?.draftId}
        />
        <div className="desk-scope" aria-label="Organisation scope">
          <Building2 size={17} />
          <label>
            <span>Company</span>
            <select
              aria-label="Company"
              value={scope.companyId}
              disabled={directory.loading}
              onChange={(e) => changeScope('companyId', e.target.value)}
            >
              <option value="">All companies</option>
              {dir.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <span className="desk-scope-divider">/</span>
          <label>
            <span>Division</span>
            <select
              aria-label="Division"
              disabled={!scope.companyId}
              value={scope.divisionId}
              onChange={(e) => changeScope('divisionId', e.target.value)}
            >
              <option value="">All divisions</option>
              {dir.divisions
                .filter((d) => d.companyId === scope.companyId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <span className="desk-scope-divider">/</span>
          <label>
            <span>Branch</span>
            <select
              aria-label="Branch"
              disabled={!scope.divisionId}
              value={scope.branchId}
              onChange={(e) => changeScope('branchId', e.target.value)}
            >
              <option value="">All branches</option>
              {dir.branches
                .filter((b) => b.divisionId === scope.divisionId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {notice && (
          <p className="desk-success" role="status">
            <Check size={15} />
            {notice}
            <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
              ×
            </button>
          </p>
        )}
        {directory.error && <ErrorNotice text={directory.error} retry={directory.reload} />}
        {section === 'overview' && (
          <>
            <div className="desk-section-line">
              <h2>Your balances</h2>
              {!!overview.data?.currencies.length && (
                <select
                  aria-label="Overview currency"
                  value={activeCurrency?.currency ?? ''}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {overview.data.currencies.map((c) => (
                    <option key={c.currency}>{c.currency}</option>
                  ))}
                </select>
              )}
            </div>
            {overview.error ? (
              <ErrorNotice text={overview.error} retry={overview.reload} />
            ) : overview.loading ? (
              <div className="desk-loading" role="status">
                Loading your balances…
              </div>
            ) : (
              <>
                <div className="desk-stats">
                  <button className="desk-stat desk-stat-primary" onClick={() => filtered('all')}>
                    <span>
                      <Wallet size={18} /> Total outstanding
                    </span>
                    <strong>
                      {activeCurrency
                        ? money(activeCurrency.outstanding, activeCurrency.currency)
                        : '—'}
                    </strong>
                    <small>
                      {activeCurrency
                        ? `${activeCurrency.count} recorded invoice${activeCurrency.count === 1 ? '' : 's'} · ${activeCurrency.currency}`
                        : 'Your first invoice starts the picture'}
                      <ArrowUpRight size={17} />
                    </small>
                  </button>
                  <button className="desk-stat" onClick={() => filtered('overdue')}>
                    <span>
                      <CalendarClock size={18} /> Overdue
                    </span>
                    <strong className="desk-overdue-value">
                      {activeCurrency
                        ? money(activeCurrency.overdue, activeCurrency.currency)
                        : '—'}
                    </strong>
                    <small>
                      Past the agreed due date
                      <ArrowUpRight size={16} />
                    </small>
                  </button>
                  <button className="desk-stat" onClick={() => filtered('due')}>
                    <span>
                      <ArrowDownLeft size={18} /> Due soon
                    </span>
                    <strong>
                      {activeCurrency ? money(activeCurrency.due, activeCurrency.currency) : '—'}
                    </strong>
                    <small>
                      Today and the next 7 days
                      <ArrowUpRight size={16} />
                    </small>
                  </button>
                </div>
                {!overview.data?.currencies.length && (
                  <div className="desk-welcome">
                    <div className="desk-welcome-art">
                      <FileText size={40} strokeWidth={1.2} />
                      <span>
                        <Check size={16} />
                      </span>
                    </div>
                    <div>
                      <h2>A fresh start for your invoices.</h2>
                      <p>
                        Add a supplier, record your first purchase, and give every payment a place
                        to belong.
                      </p>
                      <div className="desk-welcome-steps">
                        <span>01 · Add a supplier</span>
                        <span>02 · Save an invoice</span>
                        <span>03 · Track payments</span>
                      </div>
                    </div>
                    {manage && (
                      <Btn
                        variant="secondary"
                        iconRight={<ArrowUpRight size={15} />}
                        onClick={() => setEditor({ kind: 'supplier' })}
                      >
                        Add your first supplier
                      </Btn>
                    )}
                  </div>
                )}
              </>
            )}
            <div className="desk-overview-bottom">
              <section className="desk-panel">
                <div className="desk-panel-title">
                  <h2>Needs your attention</h2>
                  <button onClick={() => filtered('overdue')}>
                    View overdue <ArrowUpRight size={14} />
                  </button>
                </div>
                <InvoiceList
                  rows={rows.slice(0, 5)}
                  loading={invoices.loading}
                  error={invoices.error}
                  retry={invoices.reload}
                  onSelect={setSelected}
                  emptyTitle="Nothing overdue"
                  emptyText="Invoices that pass their due date will appear here."
                  compact
                />
              </section>
              <section className="desk-panel">
                <div className="desk-panel-title">
                  <h2>Who you owe</h2>
                  <span>{activeCurrency?.currency}</span>
                </div>
                {overview.error ? (
                  <p className="desk-muted desk-pad">Balances unavailable.</p>
                ) : overview.loading ? (
                  <p className="desk-muted desk-pad">Loading supplier balances…</p>
                ) : !overview.data?.suppliers.some(
                    (s) => s.currency === activeCurrency?.currency,
                  ) ? (
                  <div className="desk-empty">
                    <Users size={25} />
                    <h3>No outstanding balances</h3>
                    <p>Supplier balances will appear as invoices are added.</p>
                  </div>
                ) : (
                  <div className="desk-creditors">
                    {overview.data.suppliers
                      .filter((s) => s.currency === activeCurrency?.currency)
                      .slice(0, 6)
                      .map((s) => (
                        <button
                          key={s.id + s.currency}
                          onClick={() => {
                            go('invoices');
                            setSupplierId(s.id);
                            setStatus('all');
                          }}
                        >
                          <span className="desk-avatar">{s.name.slice(0, 1)}</span>
                          <span>
                            <strong>{s.name}</strong>
                            <small>
                              {s.count} open invoice{s.count === 1 ? '' : 's'}
                            </small>
                          </span>
                          <b>{money(s.outstanding, s.currency)}</b>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                  </div>
                )}
              </section>
            </div>
            <p className="desk-footnote">
              <CircleHelp size={14} /> Balances stay in their original currency. Payments here
              record money already paid.
            </p>
          </>
        )}
        {section === 'invoices' && (
          <section className="desk-panel">
            <div className="desk-register-toolbar">
              <div className="desk-search">
                <Search size={17} />
                <input
                  aria-label="Search invoices"
                  placeholder="Search invoices or suppliers"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <select
                aria-label="Invoice status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                {[
                  ['all', 'All invoices'],
                  ['unpaid', 'Unpaid'],
                  ['partial', 'Part paid'],
                  ['overdue', 'Overdue'],
                  ['due', 'Due in 7 days'],
                  ['paid', 'Paid'],
                  ['void', 'Void'],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              {supplierId && (
                <button
                  className="desk-filter-chip"
                  onClick={() => {
                    setSupplierId('');
                    setPage(1);
                  }}
                >
                  Supplier filter ×
                </button>
              )}
            </div>
            <InvoiceList
              rows={rows}
              loading={invoices.loading || deferredSearch !== search}
              error={invoices.error}
              retry={invoices.reload}
              onSelect={setSelected}
              emptyTitle={
                search || status !== 'all' || supplierId
                  ? 'No matching invoices'
                  : 'Your invoice register starts here'
              }
              emptyText={
                search || status !== 'all' || supplierId
                  ? 'Try a different search or filter.'
                  : 'Record a supplier invoice to track its due date and payments.'
              }
            />
            {!!invoices.data?.total && (
              <footer className="desk-pagination">
                <span>
                  {invoices.data.total} invoices · Page {page} of{' '}
                  {Math.ceil(invoices.data.total / 25)}
                </span>
                <button
                  aria-label="Previous page"
                  disabled={page === 1 || invoices.loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  aria-label="Next page"
                  disabled={page * 25 >= invoices.data.total || invoices.loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </footer>
            )}
          </section>
        )}
        {section === 'suppliers' && (
          <section className="desk-panel">
            <div className="desk-register-toolbar">
              <div className="desk-search">
                <Search size={17} />
                <input
                  aria-label="Search suppliers"
                  placeholder="Find a supplier"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <p>Supplier directory · Company level</p>
            </div>
            {suppliers.error ? (
              <ErrorNotice text={suppliers.error} retry={suppliers.reload} />
            ) : suppliers.loading ? (
              <p className="desk-loading" role="status">
                Loading suppliers…
              </p>
            ) : !suppliers.data?.length ? (
              <div className="desk-empty">
                <Users size={30} />
                <h3>{search ? 'No matching suppliers' : 'A home for your suppliers'}</h3>
                <p>
                  {search
                    ? 'Try another name.'
                    : 'Add a supplier once, then keep all their invoices together.'}
                </p>
              </div>
            ) : (
              <div className="desk-suppliers">
                {suppliers.data.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      go('invoices');
                      setSupplierId(s.id);
                      setStatus('all');
                    }}
                  >
                    <span className="desk-avatar">{s.name.slice(0, 1)}</span>
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {dir.companies.find((c) => c.id === s.companyId)?.name ?? 'Company'}
                      </small>
                      <small>{s.email || s.phone || 'No contact details'}</small>
                    </span>
                    <span className="desk-supplier-open">
                      View invoices <ArrowUpRight size={15} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
      {!!selected && !editor && (
        <Modal
          open
          size="xl"
          title={invoice?.invoiceNumber ?? 'Invoice details'}
          subtitle={invoice?.supplier.name}
          onClose={() => setSelected('')}
        >
          {detail.error ? (
            <ErrorNotice text={detail.error} retry={detail.reload} />
          ) : !invoice ? (
            <p className="desk-loading">Loading invoice…</p>
          ) : (
            <InvoiceDetail
              key={invoice.id}
              invoice={invoice}
              manage={manage}
              payments={payments}
              onAction={(kind, paymentId) => setEditor({ kind, invoice, paymentId })}
              reload={() => {
                detail.reload();
                invoices.reload();
              }}
            />
          )}
        </Modal>
      )}
      {editor && (
        <DeskEditor
          {...editor}
          scope={scope}
          directory={dir}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function ErrorNotice({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div role="alert" className="desk-error">
      {text}
      <button onClick={retry}>Try again</button>
    </div>
  );
}
function InvoiceList({
  rows,
  loading,
  error,
  retry,
  onSelect,
  emptyTitle,
  emptyText,
  compact = false,
}: {
  rows: Invoice[];
  loading: boolean;
  error: string;
  retry: () => void;
  onSelect: (id: string) => void;
  emptyTitle: string;
  emptyText: string;
  compact?: boolean;
}) {
  if (error) return <ErrorNotice text={error} retry={retry} />;
  if (loading)
    return (
      <div className="desk-loading" role="status">
        Loading invoices…
      </div>
    );
  if (!rows.length)
    return (
      <div className="desk-empty">
        <Receipt size={28} />
        <h3>{emptyTitle}</h3>
        <p>{emptyText}</p>
      </div>
    );
  return (
    <div className={`desk-invoice-list ${compact ? 'desk-compact' : ''}`}>
      <div className="desk-list-head">
        <span>Invoice / supplier</span>
        {!compact && <span>Branch</span>}
        <span>Due date</span>
        <span>Outstanding</span>
        <span>Status</span>
      </div>
      {rows.map((r) => (
        <button className="desk-invoice-row" key={r.id} onClick={() => onSelect(r.id)}>
          <span>
            <strong>{r.invoiceNumber}</strong>
            <small>{r.supplier.name}</small>
          </span>
          {!compact && (
            <span>
              <span>{r.branch.name}</span>
              <small>{r.division.name}</small>
            </span>
          )}
          <span className="desk-row-date">{dateLabel(r.dueDate)}</span>
          <span className="desk-row-money">{money(r.outstanding, r.currency)}</span>
          <span className={`desk-badge desk-badge-${r.status.toLowerCase().replace(' ', '-')}`}>
            {r.status}
          </span>
        </button>
      ))}
    </div>
  );
}

function InvoiceDetail({
  invoice: r,
  manage,
  payments,
  onAction,
  reload,
}: {
  invoice: Invoice;
  manage: boolean;
  payments: boolean;
  onAction: (kind: 'payment' | 'edit' | 'void' | 'reverse', paymentId?: string) => void;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const files: FilePreviewSource[] = (r.attachments ?? []).map((file) => ({
    kind: 'invoice-attachment',
    id: file.id,
    invoiceId: r.id,
    title: file.name,
    fileName: file.name,
  }));
  const uploadBusy = useRef(false);
  async function upload(file?: File) {
    if (!file || uploadBusy.current) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose a file no larger than 10 MB.');
      return;
    }
    uploadBusy.current = true;
    setBusy(true);
    setError('');
    try {
      const data = new FormData();
      data.append('file', file);
      await backendUpload(`/invoice-desk/invoices/${r.id}/attachments`, data);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      uploadBusy.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="desk-detail">
      <div className="desk-detail-top">
        <div>
          <span className={`desk-badge desk-badge-${r.status.toLowerCase().replace(' ', '-')}`}>
            {r.status}
          </span>
          <h2>{r.description}</h2>
          <p>
            {r.company.name} <ChevronRight size={13} /> {r.division.name} <ChevronRight size={13} />{' '}
            {r.branch.name}
          </p>
        </div>
        <div>
          <span>Outstanding</span>
          <strong>{money(r.outstanding, r.currency)}</strong>
        </div>
      </div>
      <div className="desk-detail-facts">
        <div>
          <span>Invoice total</span>
          <strong>{money(r.totalAmount, r.currency)}</strong>
        </div>
        <div>
          <span>Paid to date</span>
          <strong>{money(r.paidAmount, r.currency)}</strong>
        </div>
        <div>
          <span>Invoice date</span>
          <strong>{dateLabel(r.invoiceDate)}</strong>
        </div>
        <div>
          <span>Due date</span>
          <strong>{dateLabel(r.dueDate)}</strong>
        </div>
      </div>
      {!r.voidedAt && (
        <div className="desk-detail-actions">
          {manage && !r.payments?.length && (
            <Btn variant="secondary" onClick={() => onAction('edit')}>
              Edit invoice
            </Btn>
          )}
          {payments && r.outstanding !== '0.00' && (
            <Btn onClick={() => onAction('payment')}>Record payment</Btn>
          )}
          {manage && Number(r.paidAmount) === 0 && (
            <button className="desk-text-button" onClick={() => onAction('void')}>
              Void invoice
            </button>
          )}
        </div>
      )}
      {r.notes && (
        <div className="desk-detail-notes">
          <h3>Notes & purchase reference</h3>
          <p>{r.notes}</p>
        </div>
      )}
      <section>
        <h3>Payment history</h3>
        {!r.payments?.length ? (
          <p className="desk-muted">No payments recorded yet.</p>
        ) : (
          r.payments.map((p) => (
            <div className="desk-history-row" key={p.id}>
              <span>
                <strong>
                  {money(p.amount, r.currency)}{' '}
                  {p.reversedAt && <span className="desk-badge">Reversed</span>}
                </strong>
                <small>
                  {dateLabel(p.paymentDate)} · {p.method} · {p.reference || 'No reference'}
                </small>
                {p.reversalReason && <small>Reason: {p.reversalReason}</small>}
              </span>
              {payments &&
                !p.reversedAt &&
                !r.voidedAt &&
                (p.cashMovement ? (
                  <Link className="desk-text-button" href="/cash-desk">
                    Manage in Cash Desk
                  </Link>
                ) : (
                  <button onClick={() => onAction('reverse', p.id)}>Reverse</button>
                ))}
            </div>
          ))
        )}
      </section>
      <section>
        <div className="desk-panel-title">
          <h3>Original invoice & documents</h3>
          {manage && !r.voidedAt && (
            <label className="desk-upload">
              <Paperclip size={14} />
              {busy ? 'Uploading…' : 'Attach file'}
              <input
                type="file"
                aria-label="Attach invoice document"
                accept="application/pdf,image/png,image/jpeg"
                disabled={busy}
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
        <p className="desk-muted">PDF, PNG or JPEG · Up to 10 MB each · 10 files per invoice</p>
        {error && (
          <p role="alert" className="desk-error">
            {error}
          </p>
        )}
        {files.map((file, index) => (
          <button
            type="button"
            className="desk-attachment"
            style={{ width: '100%', textAlign: 'left' }}
            key={file.id}
            aria-label={`Preview ${file.title}`}
            onClick={() => setPreview(file)}
          >
            <FileText size={18} />
            <span>
              {file.title}
              <small>{Math.ceil((r.attachments?.[index]?.size ?? 0) / 1024)} KB</small>
            </span>
            <span className="desk-muted">Preview</span>
          </button>
        ))}
      </section>
      {preview && (
        <FilePreviewDialog sources={files} initial={preview} onClose={() => setPreview(null)} />
      )}
      <section>
        <h3>Activity</h3>
        <div className="desk-timeline">
          {r.events?.map((e) => (
            <div key={e.id}>
              <span />
              <p>
                <strong>{e.detail}</strong>
                <small>
                  {e.actorName} · {dateLabel(e.createdAt)}
                </small>
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
