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
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Building2,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import { Btn, FormDateField, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendGet } from '@/lib/api-client';
import { CashEditor } from './cash-editor';
import { CashExpenses } from './cash-expenses';
import {
  Account,
  CashOverview,
  Directory,
  Editor,
  Invoice,
  InvoiceOverview,
  Loan,
  Movement,
  Page,
  Scope,
  dateLabel,
  localToday,
  money,
  movementLabels,
  expenseCategories,
} from './types';
import '../invoice-desk/invoice-desk.css';
import './cash-desk.css';

const deskApp = getApp('cash-desk')!;
const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sales', label: 'Daily sales', icon: Banknote },
  { id: 'expenses', label: 'Expenses', icon: ArrowUpRight },
  { id: 'movements', label: 'Movements', icon: ArrowLeftRight },
  { id: 'accounts', label: 'Accounts', icon: Wallet },
  { id: 'loans', label: 'Intercompany', icon: Building2 },
  { id: 'suppliers', label: 'Supplier balances', icon: Receipt },
] as const;
type Section = (typeof sections)[number]['id'];
const emptyDirectory: Directory = { companies: [], divisions: [], branches: [] };

export function CashDesk({ targetRecordId }: { targetRecordId?: string } = {}) {
  const { hasPermission } = useAuth(),
    allowed = hasPermission('cash_desk.view'),
    manage = hasPermission('cash_desk.manage'),
    record = hasPermission('cash_desk.record'),
    reverse = hasPermission('cash_desk.reverse');
  const invoiceAccess = hasPermission('invoice_desk.view'),
    pay = record && hasPermission('invoice_desk.payments');
  const [section, setSection] = useDeskSection(
      'cash-desk',
      sections.map((item) => item.id),
    ),
    [scope, setScope] = useWorkspaceState<Scope>('cash-desk.scope', {
      companyId: '',
      divisionId: '',
      branchId: '',
    });
  const [date, setDate] = useWorkspaceState('cash-desk.date', localToday),
    [currency, setCurrency] = useWorkspaceState('cash-desk.currency', ''),
    [search, setSearch] = useWorkspaceState('cash-desk.search', ''),
    [kind, setKind] = useWorkspaceState('cash-desk.kind', ''),
    [accountId, setAccountId] = useWorkspaceState('cash-desk.accountId', ''),
    [page, setPage] = useWorkspaceState('cash-desk.page', 1);
  const [editor, setEditor] = useState<Editor | null>(null),
    [notice, setNotice] = useState('');
  const [selectedId, selectRecord] = useDeskRecordSelection('cash-desk', targetRecordId);
  const detail = useWorkspaceResource<Movement>(
    `/cash-desk/movements/${encodeURIComponent(selectedId)}`,
    {},
    allowed && !!selectedId,
  );
  const selected = detail.data;
  const setSelected = (row: Movement | null) => selectRecord(row?.id ?? '');
  const [expenseRevision, setExpenseRevision] = useState(0);
  const deferred = useDeferredValue(search),
    query = Object.fromEntries(Object.entries(scope).filter(([, v]) => v));
  const directory = useWorkspaceResource<Directory>('/cash-desk/directory', {}, allowed);
  const allAccounts = useWorkspaceResource<Account[]>('/cash-desk/accounts', {}, allowed);
  const accounts = useWorkspaceResource<Account[]>('/cash-desk/accounts', query, allowed);
  const overview = useWorkspaceResource<CashOverview>(
    '/cash-desk/overview',
    { ...query, date },
    allowed,
  );
  const movements = useWorkspaceResource<Page<Movement>>(
    '/cash-desk/movements',
    {
      ...query,
      page: section === 'overview' ? 1 : page,
      ...(section === 'sales'
        ? { kind: 'SALES_INCOME', date }
        : section === 'movements'
          ? { ...(kind ? { kind } : {}), ...(accountId ? { accountId } : {}), search: deferred }
          : {}),
    },
    allowed && ['overview', 'sales', 'movements'].includes(section),
  );
  const loans = useWorkspaceResource<Page<Loan>>(
    '/cash-desk/loans',
    { ...query, page },
    allowed && section === 'loans',
  );
  const supplierOverview = useWorkspaceResource<InvoiceOverview>(
    '/invoice-desk/overview',
    query,
    allowed && invoiceAccess,
  );
  const invoices = useWorkspaceResource<Page<Invoice>>(
    '/invoice-desk/invoices',
    { ...query, page, search: deferred, status: 'all' },
    allowed && invoiceAccess && section === 'suppliers',
  );
  const dir = directory.data ?? emptyDirectory;
  const currencies = overview.data?.currencies ?? [],
    current = currencies.find((c) => c.currency === currency) ?? currencies[0];
  const owed = supplierOverview.data?.currencies.find((c) => c.currency === current?.currency);
  const failures = [
    directory.error,
    accounts.error,
    overview.error,
    movements.error,
    loans.error,
    supplierOverview.error,
    invoices.error,
  ].filter(Boolean);
  function reload() {
    setExpenseRevision((r) => r + 1);
    directory.reload();
    allAccounts.reload();
    accounts.reload();
    overview.reload();
    movements.reload();
    detail.reload();
    loans.reload();
    supplierOverview.reload();
    invoices.reload();
  }
  useLinkedDeskChanges('cash-desk', !!editor, reload);
  function go(next: Section) {
    setSection(next);
    setPage(1);
    setSearch('');
    setSelected(null);
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
    setAccountId('');
    setSelected(null);
  }
  const start = (movementKind = 'DAILY_SALES') => setEditor({ kind: 'movement', movementKind });
  async function resumeDraft(draft: WorkspaceDraft) {
    const kind = draft.context.kind as Editor['kind'];
    if (!['account', 'movement', 'reverse'].includes(kind))
      throw new Error('This draft cannot be opened in Cash Desk.');
    if (kind === 'account' ? !manage : kind === 'reverse' ? !reverse : !record)
      throw new Error('Your role cannot continue this draft.');
    if (draft.context.invoiceId && !pay)
      throw new Error('Invoice payment access is required to continue this draft.');
    const [invoice, loan, movement] = await Promise.all([
      draft.context.invoiceId
        ? backendGet<Invoice>(
            `/invoice-desk/invoices/${encodeURIComponent(draft.context.invoiceId)}`,
          )
        : undefined,
      draft.context.loanId
        ? backendGet<Loan>(`/cash-desk/loans/${encodeURIComponent(draft.context.loanId)}`)
        : undefined,
      draft.context.movementId
        ? backendGet<Movement>(
            `/cash-desk/movements/${encodeURIComponent(draft.context.movementId)}`,
          )
        : undefined,
    ]);
    allAccounts.reload();
    setEditor({
      kind,
      movementKind: draft.context.movementKind || undefined,
      invoice,
      loan,
      movement,
      draftId: draft.id,
      needsReview:
        (!!invoice && String(invoice.version) !== draft.context.version) ||
        (!!loan &&
          (loan.outstanding !== draft.context.loanBalance ||
            (loan.voidedAt ?? '') !== draft.context.loanVoided)) ||
        (!!movement && (movement.reversedAt ?? '') !== draft.context.movementReversed),
    });
  }
  if (!allowed)
    return (
      <div className="invoice-desk desk-denied">
        <Wallet size={36} />
        <h1>Cash Desk</h1>
        <p>Ask your administrator for Cash Desk access to open this app.</p>
      </div>
    );
  return (
    <div className="invoice-desk cash-desk">
      <aside className="desk-rail">
        <div className="desk-identity">
          <AppGlyph app={deskApp} size="medium" />
          <div>
            <strong>Cash Desk</strong>
            <span>Know where your money goes</span>
          </div>
        </div>
        <nav aria-label="Cash Desk">
          {sections.map((s) => (
            <button
              key={s.id}
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => go(s.id)}
            >
              <s.icon size={17} />
              {s.label}
              <ChevronRight size={13} />
            </button>
          ))}
        </nav>
        <div className="desk-rail-note">
          <span className="desk-note-icon">
            <CircleHelp size={15} />
          </span>
          <strong>Every movement accounted for.</strong>
          <p>
            Daily income, money between companies and supplier payments, connected to the same
            organisation.
          </p>
        </div>
        <span className="desk-os-label">ITEMBA OS</span>
      </aside>
      <div className="desk-main">
        <header className="desk-header">
          <div>
            <p className="desk-eyebrow">YOUR MONEY, IN VIEW</p>
            <h1>{sections.find((s) => s.id === section)?.label}</h1>
            <p>
              {section === 'overview'
                ? 'A clear picture of the money you hold and the money you owe.'
                : section === 'expenses'
                  ? 'Manage everyday spending and see where your money goes.'
                  : section === 'sales'
                    ? 'Keep a daily record of money received from sales.'
                    : section === 'accounts'
                      ? 'Cash tills, bank accounts and mobile wallets.'
                      : section === 'loans'
                        ? 'Track lending and repayments within your group.'
                        : section === 'suppliers'
                          ? 'The same invoices and balances as Invoice Desk.'
                          : 'A permanent record of every receipt, payment and transfer.'}
            </p>
          </div>
          <div className="desk-header-actions">
            {hasPermission('journal_entries.view') && (
              <Link className="desk-text-button" href="/reports?view=accounting&tab=cash">
                Accounting →
              </Link>
            )}
            <button className="desk-icon-button" aria-label="Refresh Cash Desk" onClick={reload}>
              <RefreshCw size={17} />
            </button>
            {section === 'accounts'
              ? manage && (
                  <Btn icon={<Plus size={15} />} onClick={() => setEditor({ kind: 'account' })}>
                    New account
                  </Btn>
                )
              : record &&
                section !== 'suppliers' && (
                  <Btn
                    icon={<Plus size={15} />}
                    disabled={!allAccounts.data?.length}
                    onClick={() =>
                      start(
                        section === 'loans'
                          ? 'LOAN'
                          : section === 'expenses'
                            ? 'EXPENSE'
                            : 'DAILY_SALES',
                      )
                    }
                  >
                    {section === 'loans'
                      ? 'Record a loan'
                      : section === 'expenses'
                        ? 'Record expense'
                        : section === 'sales'
                          ? 'Record daily sales'
                          : 'Record movement'}
                  </Btn>
                )}
          </div>
        </header>
        <WorkspaceDraftShelf
          appId="cash-desk"
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
          <p role="status" className="desk-success">
            {notice}
            <button onClick={() => setNotice('')} aria-label="Dismiss message">
              ×
            </button>
          </p>
        )}
        {failures.length > 0 && (
          <p role="alert" className="desk-error">
            {[...new Set(failures)].join(' ')} <button onClick={reload}>Retry</button>
          </p>
        )}
        {(section === 'overview' || section === 'sales') && (
          <div className="cash-toolbar">
            <div className="ui-date-caption">
              Sales date{' '}
              <FormDateField
                aria-label="Sales date"
                value={date}
                max={localToday()}
                onChange={(value) => {
                  if (value) setDate(value);
                  setPage(1);
                }}
                className="ui-date-field-inline"
              />
            </div>
            <label>
              Currency{' '}
              <select value={current?.currency ?? ''} onChange={(e) => setCurrency(e.target.value)}>
                {currencies.length ? (
                  currencies.map((c) => <option key={c.currency}>{c.currency}</option>)
                ) : (
                  <option value="">No accounts yet</option>
                )}
              </select>
            </label>
            <span>Dates use East Africa Time</span>
          </div>
        )}
        {section === 'overview' && (
          <>
            <div className="cash-stats">
              <div className="cash-balance">
                <span>
                  <Wallet size={17} /> Recorded balance now
                </span>
                <strong>
                  {overview.loading
                    ? '…'
                    : current
                      ? money(current.balance, current.currency)
                      : '—'}
                </strong>
                <small>
                  {current
                    ? `${current.accounts} account${current.accounts === 1 ? '' : 's'} · ${current.currency}`
                    : 'Create your first account to begin'}
                </small>
              </div>
              <div>
                <span>
                  <ArrowDownLeft size={17} /> Daily sales · {dateLabel(date)}
                </span>
                <strong>
                  {overview.loading ? '…' : current ? money(current.sales, current.currency) : '—'}
                </strong>
                <small>Sales received into your accounts</small>
              </div>
              <button onClick={() => go('suppliers')}>
                <span>
                  <Receipt size={17} /> Owed to suppliers
                </span>
                <strong>
                  {!invoiceAccess
                    ? 'Access required'
                    : supplierOverview.loading
                      ? '…'
                      : supplierOverview.error
                        ? 'Unavailable'
                        : current
                          ? money(owed?.outstanding ?? '0', current.currency)
                          : '—'}
                </strong>
                <small>
                  Outstanding Invoice Desk balances <ChevronRight size={13} />
                </small>
              </button>
            </div>
            {!accounts.loading && !accounts.error && !accounts.data?.length ? (
              <Empty
                title="Give your money a home"
                description="Add a cash till, bank account or mobile wallet, then start recording your daily sales and payments."
              >
                {manage && (
                  <Btn icon={<Plus size={15} />} onClick={() => setEditor({ kind: 'account' })}>
                    Create your first account
                  </Btn>
                )}
              </Empty>
            ) : (
              <>
                <div className="cash-shortcuts">
                  {record &&
                    [
                      ['DAILY_SALES', 'Record daily sales', Banknote],
                      ['EXPENSE', 'Record an expense', ArrowUpRight],
                      ['TRANSFER', 'Move between accounts', ArrowLeftRight],
                    ].map(([k, label, Icon]) => {
                      const I = Icon as typeof Banknote;
                      return (
                        <button key={String(k)} onClick={() => start(String(k))}>
                          <I size={18} />
                          <span>{String(label)}</span>
                          <ChevronRight size={14} />
                        </button>
                      );
                    })}
                </div>
                <div className="cash-section-title">
                  <h2>Recent movements</h2>
                  <button onClick={() => go('movements')}>
                    View all <ChevronRight size={14} />
                  </button>
                </div>
                <MovementList
                  loading={movements.loading}
                  rows={(movements.data?.rows ?? []).slice(0, 6)}
                  onSelect={setSelected}
                />
              </>
            )}
          </>
        )}
        {(section === 'sales' || section === 'movements') && (
          <>
            {section === 'movements' && (
              <div className="cash-toolbar">
                <label className="cash-search">
                  <Search size={16} />
                  <input
                    aria-label="Search movements"
                    placeholder="Search description or reference"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
                <select
                  aria-label="Movement type"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All movements</option>
                  {Object.entries(movementLabels).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Account filter"
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All accounts</option>
                  {accounts.data?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.company.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {section === 'sales' && (
              <p className="cash-sales-total">
                Sales received{' '}
                <strong>{current ? money(current.sales, current.currency) : '—'}</strong>
                <span>
                  Includes manual totals and Sales Desk receipts. Reversed records are excluded.
                </span>
              </p>
            )}
            <MovementList
              rows={movements.data?.rows ?? []}
              loading={movements.loading}
              onSelect={setSelected}
            />
            <Pagination page={page} total={movements.data?.total ?? 0} onChange={setPage} />
          </>
        )}
        {section === 'expenses' && (
          <CashExpenses
            key={JSON.stringify(scope)}
            scope={scope}
            accounts={accounts.data ?? []}
            revision={expenseRevision}
            onSelect={setSelected}
            onSuppliers={() => go('suppliers')}
            onAccounts={() => go('accounts')}
          />
        )}
        {section === 'accounts' &&
          (accounts.loading ? (
            <Loading />
          ) : accounts.data?.length ? (
            <div className="cash-account-grid">
              {accounts.data.map((a) => (
                <button
                  className="cash-account"
                  key={a.id}
                  onClick={() => {
                    go('movements');
                    setAccountId(a.id);
                  }}
                >
                  <div>
                    <Wallet size={20} />
                    <span>{a.kind.replaceAll('_', ' ')}</span>
                  </div>
                  <h2>{a.name}</h2>
                  <p>
                    {a.company.name} / {a.division.name} / {a.branch.name}
                  </p>
                  <strong>{money(a.balance, a.currency)}</strong>
                  <small>
                    View movements <ChevronRight size={13} />
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="No accounts in this scope"
              description="Create an account for a company, division and branch to start tracking its money."
            />
          ))}
        {section === 'loans' &&
          (loans.loading ? (
            <Loading />
          ) : (
            <>
              <div className="cash-loans">
                {loans.data?.rows.map((l) => (
                  <article key={l.id}>
                    <div className="cash-loan-route">
                      <span>
                        {l.lender.company.name}
                        <small>Lender · {l.lender.name}</small>
                      </span>
                      <ArrowRight />
                      <span>
                        {l.borrower.company.name}
                        <small>Borrower · {l.borrower.name}</small>
                      </span>
                    </div>
                    <h2>{l.description}</h2>
                    <dl>
                      <div>
                        <dt>Amount lent</dt>
                        <dd>{money(l.principal, l.currency)}</dd>
                      </div>
                      <div>
                        <dt>Remaining</dt>
                        <dd>{money(l.outstanding, l.currency)}</dd>
                      </div>
                      <div>
                        <dt>Due</dt>
                        <dd>
                          {l.voidedAt
                            ? 'Reversed'
                            : l.dueDate
                              ? dateLabel(l.dueDate)
                              : 'No due date'}
                        </dd>
                      </div>
                    </dl>
                    {record && !l.voidedAt && !/^0(?:\.0+)?$/.test(l.outstanding) && (
                      <Btn
                        variant="secondary"
                        onClick={() => setEditor({ kind: 'movement', loan: l })}
                      >
                        Record repayment
                      </Btn>
                    )}
                  </article>
                ))}
              </div>
              {!loans.data?.rows.length && (
                <Empty
                  title="No intercompany loans yet"
                  description="Record money lent from one group company to another, and track each repayment."
                />
              )}
              <Pagination page={page} total={loans.data?.total ?? 0} onChange={setPage} />
            </>
          ))}
        {section === 'suppliers' &&
          (!invoiceAccess ? (
            <Empty
              title="Invoice Desk access needed"
              description="Supplier balances are shared with Invoice Desk. Ask your administrator for access to view them here."
            />
          ) : (
            <>
              <div className="cash-section-title">
                <h2>Outstanding by supplier</h2>
                <Link href="/invoice-desk">
                  Open Invoice Desk <ChevronRight size={14} />
                </Link>
              </div>
              <div className="cash-supplier-balances">
                {supplierOverview.data?.suppliers.map((s) => (
                  <div key={`${s.id}:${s.currency}`}>
                    <span>
                      {s.name}
                      <small>
                        {s.count} open invoice{s.count === 1 ? '' : 's'}
                      </small>
                    </span>
                    <strong>{money(s.outstanding, s.currency)}</strong>
                  </div>
                ))}
              </div>
              {!supplierOverview.loading &&
                !supplierOverview.error &&
                !supplierOverview.data?.suppliers.length && (
                  <p className="desk-muted">No outstanding supplier balances in this scope.</p>
                )}
              <div className="cash-toolbar">
                <label className="cash-search">
                  <Search size={16} />
                  <input
                    aria-label="Search supplier invoices"
                    placeholder="Search supplier or invoice"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
              </div>
              <div className="cash-invoices">
                {invoices.loading ? (
                  <Loading />
                ) : (
                  invoices.data?.rows.map((i) => (
                    <div key={i.id}>
                      <Receipt size={20} />
                      <span>
                        <strong>{i.supplier.name}</strong>
                        <small>
                          {i.invoiceNumber} · {i.branch.name} · Due {dateLabel(i.dueDate)}
                        </small>
                      </span>
                      <span>
                        <strong>{money(i.outstanding, i.currency)}</strong>
                        <small>{i.status}</small>
                      </span>
                      {pay && !i.voidedAt && !/^0(?:\.0+)?$/.test(i.outstanding) && (
                        <Btn
                          variant="secondary"
                          onClick={() => setEditor({ kind: 'movement', invoice: i })}
                        >
                          Record payment
                        </Btn>
                      )}
                    </div>
                  ))
                )}
              </div>
              <Pagination page={page} total={invoices.data?.total ?? 0} onChange={setPage} />
            </>
          ))}
      </div>
      {selectedId && !editor && (
        <Modal
          open
          title={selected ? movementLabels[selected.kind] : 'Cash movement'}
          size="md"
          onClose={() => setSelected(null)}
          footer={
            <>
              <Btn variant="secondary" onClick={() => setSelected(null)}>
                Close
              </Btn>
              {selected &&
                reverse &&
                !selected.reversedAt &&
                !selected.loanFinancialEvent &&
                !selected.payrollRunId &&
                selected.kind !== 'REVERSAL' &&
                (!selected.invoicePaymentId ||
                  (invoiceAccess && hasPermission('invoice_desk.payments'))) &&
                (!selected.salesPaymentId ||
                  hasPermission('sales_desk.view', 'sales_desk.payments')) && (
                  <Btn
                    variant="danger"
                    onClick={() => {
                      setEditor({ kind: 'reverse', movement: selected });
                      setSelected(null);
                    }}
                  >
                    Reverse movement
                  </Btn>
                )}
            </>
          }
        >
          {detail.loading && <p role="status">Loading movement…</p>}
          {detail.error && (
            <div role="alert" className="desk-error">
              {detail.error} <Btn onClick={detail.reload}>Try again</Btn>
            </div>
          )}
          {selected && (
            <div className="desk-detail">
              <h2>{selected.description}</h2>
              <p>
                {dateLabel(selected.businessDate)} · {money(selected.amount, selected.currency)}
              </p>
              <p className="desk-muted">{selected.reference || 'No reference'}</p>
              {selected.kind === 'EXPENSE' && (
                <div className="cash-expense-detail">
                  <p>
                    <span>Category</span>
                    <strong>
                      {expenseCategories[selected.expenseCategory ?? ''] ?? 'Uncategorized'}
                    </strong>
                  </p>
                  <p>
                    <span>Paid to</span>
                    <strong>{selected.payee || 'Not recorded'}</strong>
                  </p>
                  {selected.expenseNotes && (
                    <p className="cash-expense-notes">
                      <span>Notes</span>
                      {selected.expenseNotes}
                    </p>
                  )}
                </div>
              )}
              {selected.salesPaymentId && (
                <p className="desk-muted">
                  Linked to Sales Desk. Reversing this receipt also restores the customer’s
                  outstanding balance.
                </p>
              )}
              <h3>Account entries</h3>
              {selected.entries.map((e) => (
                <div className="cash-entry" key={e.id}>
                  <span>
                    {e.account.name}
                    <small>{e.account.company.name}</small>
                  </span>
                  <strong>
                    {e.amount.startsWith('-') ? '' : '+'}
                    {money(e.amount, selected.currency)}
                  </strong>
                </div>
              ))}
              <p className="desk-muted">Recorded by {selected.actorName}</p>
              {selected.payrollRunId && (
                <Link href="/hr/payroll-runs" className="text-blue-600">
                  Review or reverse this payment in Payroll →
                </Link>
              )}
              {selected.loanFinancialEvent && (
                <Link
                  href={`/group-control/loans-debts/loans/${selected.loanFinancialEvent.loanId}`}
                  className="text-blue-600"
                >
                  Review or reverse this event in the loan history →
                </Link>
              )}
              {selected.reversedAt && (
                <p className="desk-error">Reversed · {selected.reversalReason}</p>
              )}
              {selected.kind === 'REVERSAL' && (
                <p className="desk-muted">This correcting entry preserves the original movement.</p>
              )}
              {selected.invoicePaymentId && (
                <p className="desk-muted">
                  Linked to an Invoice Desk payment. A reversal restores the invoice balance too.
                </p>
              )}
            </div>
          )}
        </Modal>
      )}
      {editor &&
        (allAccounts.loading ? (
          <Modal open title="Loading accounts" onClose={() => setEditor(null)}>
            <Loading />
          </Modal>
        ) : allAccounts.error ? (
          <Modal open title="Accounts unavailable" onClose={() => setEditor(null)}>
            <p role="alert">{allAccounts.error}</p>
            <Btn onClick={allAccounts.reload}>Retry</Btn>
          </Modal>
        ) : (
          <CashEditor
            editor={editor}
            accounts={allAccounts.data ?? []}
            directory={dir}
            scope={scope}
            onClose={() => setEditor(null)}
            onSaved={() => {
              setEditor(null);
              setNotice('Saved. Cash and linked balances are up to date.');
              reload();
              notifyDeskSaved('cash-desk');
            }}
          />
        ))}
    </div>
  );
}
function ArrowRight() {
  return <ArrowUpRight size={18} />;
}
function Loading() {
  return (
    <p className="desk-muted desk-pad" role="status">
      Loading Cash Desk…
    </p>
  );
}
function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="cash-empty">
      <span>
        <Wallet size={30} strokeWidth={1.3} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
function MovementList({
  rows,
  loading,
  onSelect,
}: {
  rows: Movement[];
  loading: boolean;
  onSelect: (m: Movement) => void;
}) {
  if (loading) return <Loading />;
  if (!rows.length)
    return (
      <Empty
        title="No movements yet"
        description="Sales, payments and transfers will appear here as you record them."
      />
    );
  return (
    <div className="cash-movements">
      {rows.map((m) => (
        <button key={m.id} onClick={() => onSelect(m)}>
          <span className={`cash-movement-icon ${m.reversedAt ? 'is-reversed' : ''}`}>
            {['DAILY_SALES', 'SALE_RECEIPT', 'OTHER_IN', 'OPENING', 'BORROWING'].includes(
              m.kind,
            ) ? (
              <ArrowDownLeft size={18} />
            ) : ['LOAN', 'TRANSFER', 'LOAN_REPAYMENT'].includes(m.kind) ? (
              <ArrowLeftRight size={18} />
            ) : (
              <ArrowUpRight size={18} />
            )}
          </span>
          <span className="cash-movement-name">
            <strong>{m.description}</strong>
            <small>
              {movementLabels[m.kind]} · {m.entries.map((e) => e.account.name).join(' → ')}
              {m.reversedAt ? ' · Reversed' : ''}
            </small>
          </span>
          <span className="cash-movement-date">{dateLabel(m.businessDate)}</span>
          <strong className="cash-movement-amount">{money(m.amount, m.currency)}</strong>
          <ChevronRight size={14} />
        </button>
      ))}
    </div>
  );
}
function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total <= 25 && page === 1) return null;
  return (
    <div className="desk-pagination">
      <span>
        {total} records · Page {page} of {Math.max(1, Math.ceil(total / 25))}
      </span>
      <button disabled={page === 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <button disabled={page * 25 >= total} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
