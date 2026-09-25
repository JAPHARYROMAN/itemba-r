'use client';
import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { AppGlyph } from '@/components/os/app-glyph';
import { notifyDeskSaved, useLinkedDeskChanges } from '@/components/workspace/linked-desk-changes';
import { getApp } from '@/lib/apps';
import { useDeskRecordSelection } from '@/components/workspace/desk-record-selection';
import { useDeskSection } from '@/components/workspace/use-desk-section';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { WorkspaceDraftShelf, type WorkspaceDraft } from '@/components/workspace/workspace-drafts';
import {
  ArrowDownLeft,
  ChevronRight,
  LayoutDashboard,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { Btn, FormDateField, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendGet } from '@/lib/api-client';
import { SalesEditor } from './sales-editor';
import { Customer, Directory, Editor, Page, Sale, Scope, Summary, dateLabel, money } from './types';
import '../invoice-desk/invoice-desk.css';
import './sales-desk.css';
const deskApp = getApp('sales-desk')!;
const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sales', label: 'Sales', icon: Receipt },
  { id: 'customers', label: 'Customers', icon: Users },
] as const;
const emptyDirectory: Directory = { companies: [], divisions: [], branches: [] };
export function SalesDesk({ targetRecordId }: { targetRecordId?: string } = {}) {
  const { hasPermission } = useAuth(),
    allowed = hasPermission('sales_desk.view'),
    manage = hasPermission('sales_desk.manage'),
    cashAccess = hasPermission('cash_desk.view'),
    pay = hasPermission('sales_desk.payments') && cashAccess && hasPermission('cash_desk.record');
  const [section, setSection] = useDeskSection('sales-desk', [
      'overview',
      'sales',
      'customers',
    ] as const),
    [scope, setScope] = useWorkspaceState<Scope>('sales-desk.scope', {
      companyId: '',
      divisionId: '',
      branchId: '',
    });
  const [search, setSearch] = useWorkspaceState('sales-desk.search', ''),
    [status, setStatus] = useWorkspaceState('sales-desk.status', 'all'),
    [from, setFrom] = useWorkspaceState('sales-desk.from', ''),
    [to, setTo] = useWorkspaceState('sales-desk.to', ''),
    [page, setPage] = useWorkspaceState('sales-desk.page', 1),
    [customerId, setCustomerId] = useWorkspaceState('sales-desk.customerId', ''),
    [currency, setCurrency] = useWorkspaceState('sales-desk.currency', '');
  const [selected, setSelected] = useDeskRecordSelection('sales-desk', targetRecordId),
    [editor, setEditor] = useState<Editor | null>(null),
    [notice, setNotice] = useState('');
  const deferred = useDeferredValue(search),
    query = Object.fromEntries(Object.entries(scope).filter(([, v]) => v)),
    invalid = !!from && !!to && from > to;
  const directory = useWorkspaceResource<Directory>('/sales-desk/directory', {}, allowed);
  const overview = useWorkspaceResource<Summary>('/sales-desk/overview', query, allowed);
  const sales = useWorkspaceResource<Page<Sale>>(
    '/sales-desk/sales',
    {
      ...query,
      page: section === 'overview' ? 1 : page,
      ...(section === 'overview'
        ? { status: 'overdue' }
        : {
            status,
            search: deferred,
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            ...(customerId ? { customerId } : {}),
          }),
    },
    allowed && section !== 'customers' && (section === 'overview' || !invalid),
  );
  const customers = useWorkspaceResource<Customer[]>(
    '/sales-desk/customers',
    { ...(scope.companyId ? { companyId: scope.companyId } : {}), search: deferred },
    allowed && section === 'customers',
  );
  const detail = useWorkspaceResource<Sale>(
    `/sales-desk/sales/${encodeURIComponent(selected)}`,
    {},
    allowed && !!selected,
  );
  const dir = directory.data ?? emptyDirectory,
    totals = overview.data?.currencies ?? [],
    current = totals.find((c) => c.currency === currency) ?? totals[0];
  function reload() {
    overview.reload();
    sales.reload();
    customers.reload();
    detail.reload();
    directory.reload();
  }
  useLinkedDeskChanges('sales-desk', !!editor, reload);
  function go(next: typeof section) {
    setSection(next);
    setSearch('');
    setCustomerId('');
    setPage(1);
  }
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
    setCustomerId('');
    setSelected('');
  }
  function saved(id?: string) {
    const kind = editor?.kind;
    setEditor(null);
    setNotice(
      kind === 'customer'
        ? 'Customer saved.'
        : kind === 'payment'
          ? 'Payment recorded. Sales and cash balances are updated.'
          : kind === 'void'
            ? 'Sale voided. Its history is preserved.'
            : 'Sale saved. You can record payment now or later.',
    );
    if (id) setSelected(id);
    reload();
    notifyDeskSaved('sales-desk');
  }
  const failures = [directory.error, overview.error, sales.error, customers.error].filter(Boolean);
  async function resumeDraft(draft: WorkspaceDraft) {
    const kind = draft.context.kind as Editor['kind'];
    if (!['sale', 'customer', 'payment', 'void'].includes(kind))
      throw new Error('This draft cannot be opened in Sales Desk.');
    if (kind === 'payment' ? !pay : !manage)
      throw new Error('Your role cannot continue this draft.');
    const sale = draft.context.saleId
      ? await backendGet<Sale>(`/sales-desk/sales/${encodeURIComponent(draft.context.saleId)}`)
      : undefined;
    setEditor({
      kind,
      sale,
      draftId: draft.id,
      needsReview: !!sale && String(sale.version) !== draft.context.version,
    });
  }
  if (!allowed)
    return (
      <div className="invoice-desk desk-denied">
        <ShoppingBag size={36} />
        <h1>Sales Desk</h1>
        <p>Ask your administrator for Sales Desk access to open this app.</p>
      </div>
    );
  return (
    <div className="invoice-desk sales-desk">
      <aside className="desk-rail">
        <div className="desk-identity">
          <AppGlyph app={deskApp} size="medium" />
          <div>
            <strong>Sales Desk</strong>
            <span>Sell clearly. Stay in control.</span>
          </div>
        </div>
        <nav aria-label="Sales Desk">
          {sections.map((s) => (
            <button
              key={s.id}
              aria-current={s.id === section ? 'page' : undefined}
              onClick={() => go(s.id)}
            >
              <s.icon size={17} />
              {s.label}
              <ChevronRight size={13} />
            </button>
          ))}
        </nav>
        <div className="desk-rail-note">
          <strong>A simple path from sale to payment.</strong>
          <p>
            Keep customers, what they bought and what they owe together. Received payments flow into
            Cash Desk.
          </p>
        </div>
        <span className="desk-os-label">ITEMBA OS</span>
      </aside>
      <div className="desk-main">
        <header className="desk-header">
          <div>
            <p className="desk-eyebrow">GOOD BUSINESS, CLEAR RECORDS</p>
            <h1>{sections.find((s) => s.id === section)?.label}</h1>
            <p>
              {section === 'overview'
                ? 'Your sales, receipts and customer balances at a glance.'
                : section === 'sales'
                  ? 'What you sold, who bought it and what is still owed.'
                  : 'The people and businesses you sell to.'}
            </p>
          </div>
          <div className="desk-header-actions">
            <button className="desk-icon-button" aria-label="Refresh Sales Desk" onClick={reload}>
              <RefreshCw size={17} />
            </button>
            {manage && (
              <Btn
                icon={<Plus size={15} />}
                onClick={() => setEditor({ kind: section === 'customers' ? 'customer' : 'sale' })}
              >
                {section === 'customers' ? 'New customer' : 'New sale'}
              </Btn>
            )}
          </div>
        </header>
        <WorkspaceDraftShelf
          appId="sales-desk"
          onResume={resumeDraft}
          activeDraftId={editor?.draftId}
        />
        <div className="desk-scope">
          {(['companyId', 'divisionId', 'branchId'] as const).map((key, i) => {
            const list =
              i === 0
                ? dir.companies
                : i === 1
                  ? dir.divisions.filter((d) => !scope.companyId || d.companyId === scope.companyId)
                  : dir.branches.filter(
                      (b) =>
                        (!scope.companyId || b.companyId === scope.companyId) &&
                        (!scope.divisionId || b.divisionId === scope.divisionId),
                    );
            return (
              <label key={key}>
                <span>{['Company', 'Division', 'Branch'][i]}</span>
                <select value={scope[key]} onChange={(e) => changeScope(key, e.target.value)}>
                  <option value="">All {['companies', 'divisions', 'branches'][i]}</option>
                  {list.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        {notice && (
          <p className="desk-success" role="status">
            {notice}
            <button aria-label="Dismiss message" onClick={() => setNotice('')}>
              ×
            </button>
          </p>
        )}
        {!!failures.length && (
          <p className="desk-error" role="alert">
            {[...new Set(failures)].join(' ')} <button onClick={reload}>Retry</button>
          </p>
        )}
        {section === 'overview' && (
          <>
            <div className="sales-section-title">
              <span>All recorded sales in this organisation scope</span>
              <label>
                Currency{' '}
                <select
                  aria-label="Sales summary currency"
                  value={current?.currency ?? ''}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {totals.length ? (
                    totals.map((c) => <option key={c.currency}>{c.currency}</option>)
                  ) : (
                    <option value="">No sales yet</option>
                  )}
                </select>
              </label>
            </div>
            <div className="sales-stats">
              {[
                ['Sales recorded', current?.total],
                ['Payments received', current?.paid],
                ['Still to collect', current?.outstanding],
                ['Overdue', current?.overdue],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>
                    {overview.loading
                      ? '…'
                      : value && current
                        ? money(value, current.currency)
                        : '—'}
                  </strong>
                  <small>
                    {label === 'Sales recorded'
                      ? `${current?.count ?? 0} sales · excludes voids`
                      : label === 'Payments received'
                        ? 'Received through Cash Desk'
                        : label === 'Still to collect'
                          ? 'Unpaid and partly paid sales'
                          : 'Past the payment due date'}
                  </small>
                </div>
              ))}
            </div>
            {!overview.loading && !overview.error && !totals.length ? (
              <Empty
                title="Start with your customers"
                text="Add a customer, record a sale, then track payments as they come in."
              >
                {manage && (
                  <Btn
                    variant="secondary"
                    icon={<Plus size={15} />}
                    onClick={() => setEditor({ kind: 'customer' })}
                  >
                    Add your first customer
                  </Btn>
                )}
              </Empty>
            ) : !overview.error ? (
              <>
                <div className="sales-section-title">
                  <h2>Needs attention</h2>
                  <button
                    onClick={() => {
                      go('sales');
                      setStatus('overdue');
                    }}
                  >
                    View overdue sales <ChevronRight size={14} />
                  </button>
                </div>
                <SalesList
                  loading={sales.loading}
                  error={sales.error}
                  rows={sales.data?.rows ?? []}
                  onSelect={setSelected}
                  empty="No overdue sales in this scope."
                />
                <div className="sales-section-title">
                  <h2>Customer balances</h2>
                </div>
                <div className="sales-customers-owed">
                  {overview.data?.customers
                    .filter((c) => c.currency === current?.currency)
                    .slice(0, 8)
                    .map((c) => (
                      <button
                        key={`${c.id}:${c.currency}`}
                        onClick={() => {
                          go('sales');
                          setCustomerId(c.id);
                          setStatus('all');
                          setFrom('');
                          setTo('');
                        }}
                      >
                        <span>
                          {c.name}
                          <small>
                            {c.count} open sale{c.count === 1 ? '' : 's'}
                          </small>
                        </span>
                        <strong>{money(c.outstanding, c.currency)}</strong>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                </div>
              </>
            ) : null}
          </>
        )}
        {section === 'sales' && (
          <>
            <div className="sales-toolbar">
              <label className="sales-search">
                <Search size={16} />
                <input
                  aria-label="Search sales"
                  placeholder="Search sale, customer or item"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <select
                aria-label="Sale status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                {[
                  ['all', 'All statuses'],
                  ['unpaid', 'Unpaid'],
                  ['partial', 'Part paid'],
                  ['paid', 'Paid'],
                  ['overdue', 'Overdue'],
                  ['void', 'Void'],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <div className="ui-date-caption">
                From{' '}
                <FormDateField
                  aria-label="Sales from"
                  value={from}
                  onChange={(value) => {
                    setFrom(value);
                    setPage(1);
                  }}
                  className="ui-date-field-inline"
                />
              </div>
              <div className="ui-date-caption">
                To{' '}
                <FormDateField
                  aria-label="Sales to"
                  value={to}
                  onChange={(value) => {
                    setTo(value);
                    setPage(1);
                  }}
                  className="ui-date-field-inline"
                />
              </div>
            </div>
            {customerId && (
              <button
                className="desk-filter-chip"
                onClick={() => {
                  setCustomerId('');
                  setPage(1);
                }}
              >
                Customer filter · Clear ×
              </button>
            )}
            {invalid ? (
              <p role="alert" className="desk-error">
                Start date must be on or before end date.
              </p>
            ) : (
              <SalesList
                rows={sales.data?.rows ?? []}
                error={sales.error}
                loading={sales.loading}
                onSelect={setSelected}
                empty="No sales match this view."
              />
            )}
            <Pagination page={page} total={sales.data?.total ?? 0} change={setPage} />
          </>
        )}
        {section === 'customers' && (
          <>
            <div className="sales-toolbar">
              <label className="sales-search">
                <Search size={16} />
                <input
                  aria-label="Search customers"
                  placeholder="Search customers"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <span>
                Customers belong to a company. Balances follow the selected division and branch.
              </span>
            </div>
            {customers.error ? null : customers.loading ? (
              <Loading />
            ) : customers.data?.length ? (
              <div className="sales-customer-grid">
                {customers.data.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      go('sales');
                      setCustomerId(c.id);
                      setStatus('all');
                      setFrom('');
                      setTo('');
                    }}
                  >
                    <span className="sales-customer-initial">
                      {c.name.slice(0, 1).toUpperCase()}
                    </span>
                    <h2>{c.name}</h2>
                    <p>{c.company?.name}</p>
                    <small>
                      {[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details added'}
                    </small>
                    <div className="sales-customer-balances">
                      {overview.data?.customers
                        .filter((b) => b.id === c.id)
                        .map((b) => (
                          <strong key={b.currency}>{money(b.outstanding, b.currency)} owed</strong>
                        ))}
                    </div>
                    <span className="sales-customer-link">
                      View sales <ChevronRight size={13} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                title="No customers yet"
                text="Create a customer for the company you sell from, then record their first sale."
              />
            )}
          </>
        )}
      </div>
      {selected && !editor && (
        <Modal
          open
          title={detail.data?.saleNumber ?? 'Sale details'}
          size="lg"
          onClose={() => setSelected('')}
          footer={
            <>
              <Btn variant="secondary" onClick={() => setSelected('')}>
                Close
              </Btn>
              {detail.data &&
                !detail.data.voidedAt &&
                pay &&
                !/^0(?:\.0+)?$/.test(detail.data.outstanding) && (
                  <Btn
                    icon={<ArrowDownLeft size={15} />}
                    onClick={() => setEditor({ kind: 'payment', sale: detail.data! })}
                  >
                    Record payment
                  </Btn>
                )}
            </>
          }
        >
          {detail.loading ? (
            <Loading />
          ) : detail.error ? (
            <p className="desk-error" role="alert">
              {detail.error}
              <button onClick={detail.reload}>Retry</button>
            </p>
          ) : (
            detail.data && (
              <div className="sales-detail">
                <div className="sales-detail-heading">
                  <div>
                    <h2>{detail.data.customer.name}</h2>
                    <p>
                      {detail.data.company.name} / {detail.data.division.name} /{' '}
                      {detail.data.branch.name}
                    </p>
                  </div>
                  <span className="desk-badge">{detail.data.status}</span>
                </div>
                <div className="sales-detail-facts">
                  <p>
                    Sale date<strong>{dateLabel(detail.data.saleDate)}</strong>
                  </p>
                  <p>
                    Due date<strong>{dateLabel(detail.data.dueDate)}</strong>
                  </p>
                  <p>
                    Outstanding
                    <strong>{money(detail.data.outstanding, detail.data.currency)}</strong>
                  </p>
                </div>
                <div className="sales-detail-lines">
                  {detail.data.lines?.map((l) => (
                    <div key={l.id}>
                      <span>
                        <strong>{l.description}</strong>
                        <small>
                          {l.quantity} × {money(l.unitPrice, detail.data!.currency)}
                        </small>
                      </span>
                      <strong>{money(l.totalAmount, detail.data!.currency)}</strong>
                    </div>
                  ))}
                </div>
                <div className="sales-detail-totals">
                  <p>
                    Sale total
                    <strong>{money(detail.data.totalAmount, detail.data.currency)}</strong>
                  </p>
                  <p>
                    Received<strong>{money(detail.data.paidAmount, detail.data.currency)}</strong>
                  </p>
                </div>
                {detail.data.notes && <p className="sales-notes">{detail.data.notes}</p>}
                <h3>Payments</h3>
                {detail.data.payments?.length ? (
                  detail.data.payments.map((p) => (
                    <div className="sales-payment" key={p.id}>
                      <span>
                        {dateLabel(p.paymentDate)}
                        <small>
                          {p.reference || 'No reference'}
                          {p.reversedAt ? ' · Reversed' : ''}
                        </small>
                      </span>
                      <strong>{money(p.amount, detail.data!.currency)}</strong>
                      {p.cashMovement && cashAccess && (
                        <Link href="/cash-desk">View in Cash Desk</Link>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="desk-muted">No payments recorded yet.</p>
                )}
                {!pay && !detail.data.voidedAt && (
                  <p className="desk-muted">
                    Recording receipts requires Sales Desk payment access and Cash Desk recording
                    access.
                  </p>
                )}
                <h3>History</h3>
                <div className="desk-timeline">
                  {detail.data.events?.map((e) => (
                    <div key={e.id}>
                      <strong>{e.detail}</strong>
                      <small>
                        {e.actorName} · {dateLabel(e.createdAt)}
                      </small>
                    </div>
                  ))}
                </div>
                {manage && !detail.data.voidedAt && /^0(?:\.0+)?$/.test(detail.data.paidAmount) && (
                  <button
                    className="desk-text-button"
                    onClick={() => setEditor({ kind: 'void', sale: detail.data! })}
                  >
                    Void this sale
                  </button>
                )}
              </div>
            )
          )}
        </Modal>
      )}
      {editor && (
        <SalesEditor
          editor={editor}
          scope={scope}
          directory={dir}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
function Loading() {
  return (
    <p className="desk-muted desk-pad" role="status">
      Loading Sales Desk…
    </p>
  );
}
function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sales-empty">
      <span>
        <ShoppingBag size={30} strokeWidth={1.3} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
function SalesList({
  error,
  rows,
  loading,
  onSelect,
  empty,
}: {
  error: string;
  rows: Sale[];
  loading: boolean;
  onSelect: (id: string) => void;
  empty: string;
}) {
  if (error) return null;
  if (loading) return <Loading />;
  if (!rows.length)
    return <Empty title={empty} text="Your sales records will appear here as you add them." />;
  return (
    <div className="sales-register">
      {rows.map((s) => (
        <button key={s.id} onClick={() => onSelect(s.id)}>
          <Receipt size={19} />
          <span className="sales-row-name">
            <strong>{s.customer.name}</strong>
            <small>
              {s.saleNumber} · {s.branch.name}
            </small>
          </span>
          <span className="sales-row-date">
            {dateLabel(s.saleDate)}
            <small>Due {dateLabel(s.dueDate)}</small>
          </span>
          <span className="sales-row-money">
            <strong>{money(s.totalAmount, s.currency)}</strong>
            <small>{money(s.outstanding, s.currency)} owed</small>
          </span>
          <span className={`desk-badge desk-badge-${s.status.toLowerCase().replace(' ', '-')}`}>
            {s.status}
          </span>
          <ChevronRight size={14} />
        </button>
      ))}
    </div>
  );
}
function Pagination({
  page,
  total,
  change,
}: {
  page: number;
  total: number;
  change: (p: number) => void;
}) {
  if (total <= 25 && page === 1) return null;
  return (
    <div className="desk-pagination">
      <span>
        {total} sales · Page {page} of {Math.max(1, Math.ceil(total / 25))}
      </span>
      <button disabled={page === 1} onClick={() => change(page - 1)}>
        Previous
      </button>
      <button disabled={page * 25 >= total} onClick={() => change(page + 1)}>
        Next
      </button>
    </div>
  );
}
