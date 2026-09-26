'use client';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  LayoutDashboard,
  Plus,
  RefreshCw,
  StickyNote,
  ShoppingBag,
  Receipt,
  Wallet,
} from 'lucide-react';
import { AppGlyph } from '@/components/os/app-glyph';
import { Btn, FormDateField, FormInput, FormSelect, Modal } from '@/components/ui';
import {
  useWorkspaceRouter,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import { useDeskSection } from '@/components/workspace/use-desk-section';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendGet } from '@/lib/api-client';
import { getApp } from '@/lib/apps';
import { RecordsEditor } from './records-editor';
import { RecordsStatement } from './records-statement';
import {
  Directory,
  Editor,
  Entry,
  Scope,
  Section,
  Summary,
  dateLabel,
  emptyDirectory,
  emptyScope,
  isDebt,
  money,
  registers,
} from './types';
import './records.css';

const icons = {
  DEBTOR: ArrowDownLeft,
  CREDITOR: ArrowUpRight,
  SALE: Receipt,
  PURCHASE: ShoppingBag,
  EXPENSE: Wallet,
  NOTE: StickyNote,
};
const sections: readonly Section[] = ['overview', ...registers.map((r) => r.id)];
const app = getApp('records')!;
const CHANGE_EVENT = 'itemba:records-changed';
export function RecordsNotebook({ embedded = false }: { embedded?: boolean }) {
  const { hasPermission } = useAuth(),
    allowed = hasPermission('records.view'),
    manage = hasPermission('records.manage');
  const [section, setSection] = useDeskSection('records', sections);
  const [scope, setScope] = useWorkspaceState<Scope>('records.scope', emptyScope);
  const [search, setSearch] = useWorkspaceState('records.search', ''),
    [status, setStatus] = useWorkspaceState('records.status', 'all');
  const [from, setFrom] = useWorkspaceState('records.from', ''),
    [to, setTo] = useWorkspaceState('records.to', '');
  const [currency, setCurrency] = useWorkspaceState('records.currency', ''),
    [visibility, setVisibility] = useWorkspaceState('records.visibility', 'all');
  const [page, setPage] = useWorkspaceState('records.page', 1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const createTrigger = useRef<HTMLElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null),
    [notice, setNotice] = useState(''),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState('');
  const router = useWorkspaceRouter(),
    params = useWorkspaceSearchParams(),
    selected = params.get('record') ?? '';
  const register = registers.find((r) => r.id === section),
    deferred = useDeferredValue(search);
  const invalidDates = !!from && !!to && from > to;
  const query = {
    ...Object.fromEntries(Object.entries(scope).filter(([, v]) => v)),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(currency ? { currency } : {}),
    scope: visibility,
    status,
    search: deferred,
  };
  const listQuery = { ...query, ...(register ? { kind: register.kind } : {}), page };
  const directory = useWorkspaceResource<Directory>('/records/directory', {}, allowed);
  const list = useWorkspaceResource<{ rows: Entry[]; total: number; pageSize: number }>(
    '/records',
    listQuery,
    allowed && !invalidDates,
  );
  const summary = useWorkspaceResource<Summary[]>(
    '/records/summary',
    query,
    allowed && !invalidDates,
  );
  const detail = useWorkspaceResource<Entry>(
    `/records/${encodeURIComponent(selected)}`,
    {},
    allowed && !!selected,
  );
  const { reload: reloadList } = list,
    { reload: reloadSummary } = summary,
    { reload: reloadDetail } = detail;
  useEffect(() => {
    const refresh = () => {
      reloadList();
      reloadSummary();
      reloadDetail();
    };
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => window.removeEventListener(CHANGE_EVENT, refresh);
  }, [reloadList, reloadSummary, reloadDetail]);
  const refresh = () => {
    reloadList();
    reloadSummary();
    reloadDetail();
    directory.reload();
  };
  function select(id: string) {
    router.push(`/records?view=${section}${id ? `&record=${encodeURIComponent(id)}` : ''}`);
  }
  function go(next: Section) {
    setSection(next);
    setPage(1);
    setStatus('all');
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
    setVisibility('all');
    setPage(1);
  }
  function saved(id: string) {
    setNotice(
      editor?.mode === 'settle'
        ? 'Payment saved. The outstanding balance and statement have been updated.'
        : editor?.mode === 'reverse'
          ? 'Settlement reversed. Its history is preserved.'
          : editor?.mode === 'void'
            ? 'Record voided. Its history is preserved.'
            : 'Record saved.',
    );
    setEditor(null);
    select(id);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  async function exportRows() {
    setExporting(true);
    setExportError('');
    try {
      const result = await backendGet<{ filename: string; csv: string; count: number }>(
        '/records/export',
        { query: listQuery },
      );
      const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Exported ${result.count} matching records.`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }
  if (!allowed)
    return (
      <div className="records-empty">
        <BookOpen size={34} />
        <h1>Records</h1>
        <p>You need Records access to open these registers.</p>
      </div>
    );
  const dir = directory.data ?? emptyDirectory,
    total = list.data?.total ?? 0;
  const options = (rows: { id: string; name: string }[], label: string) => [
    { value: '', label },
    ...rows.map((r) => ({ value: r.id, label: r.name })),
  ];
  const selectedEntry = detail.data;
  const filterCount = [
    scope.companyId,
    scope.divisionId,
    scope.branchId,
    from,
    to,
    currency,
    visibility === 'personal',
    status !== 'all',
  ].filter(Boolean).length;
  return (
    <div className={embedded ? 'records-app records-notebook-embedded' : 'records-app'}>
      {!embedded && (
        <aside className="records-rail">
          <div className="records-identity">
            <AppGlyph app={app} size="small" />
            <div>
              <strong>Records</strong>
              <span>Your independent notebook</span>
            </div>
          </div>
          <nav aria-label="Records registers">
            <button
              aria-current={section === 'overview' ? 'page' : undefined}
              onClick={() => go('overview')}
            >
              <LayoutDashboard size={18} />
              Overview
            </button>
            {registers.map((r) => {
              const Icon = icons[r.kind];
              return (
                <button
                  key={r.id}
                  aria-current={section === r.id ? 'page' : undefined}
                  onClick={() => go(r.id)}
                >
                  <Icon size={18} />
                  {r.label}
                </button>
              );
            })}
          </nav>
          <FormSelect
            className="records-register-switcher"
            label="Register"
            value={section}
            onChange={(event) => go(event.target.value as Section)}
            options={[
              { value: 'overview', label: 'Overview' },
              ...registers.map((item) => ({ value: item.id, label: item.label })),
            ]}
          />
          <div className="records-rail-foot">
            <BookOpen size={20} />
            <strong>A place to keep track.</strong>
            <p>Keep useful records together, with balances and history of their own.</p>
            <span>Independent of your ERP</span>
          </div>
        </aside>
      )}
      <main className="records-main">
        <header className="records-header">
          <div>
            <h1>{register?.label ?? 'Overview'}</h1>
            <p>{register?.description ?? 'Your debts, transactions and notes.'}</p>
          </div>
          <div className="records-actions">
            <Btn
              variant="secondary"
              aria-label="Refresh records"
              title="Refresh records"
              onClick={refresh}
            >
              <RefreshCw size={16} />
            </Btn>
            {hasPermission('records.export') && (
              <Btn
                variant="secondary"
                icon={<Download size={16} />}
                loading={exporting}
                disabled={invalidDates}
                onClick={() => void exportRows()}
              >
                Export
              </Btn>
            )}
            {manage && (
              <Btn
                icon={<Plus size={17} />}
                onClick={(event) => {
                  createTrigger.current = event.currentTarget;
                  register
                    ? setEditor({ mode: 'create', kind: register.kind })
                    : setPickerOpen(true);
                }}
              >
                {register ? `New ${register.singular}` : 'New record'}
              </Btn>
            )}
          </div>
        </header>
        {notice && (
          <div role="status" className="records-notice">
            {notice}
            <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {(exportError || directory.error) && (
          <p className="records-error" role="alert">
            {exportError || directory.error}
          </p>
        )}
        <div className="records-tools">
          <div className="records-search">
            <FormInput
              label="Search records"
              placeholder="Title, name, reference or category"
              maxLength={100}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <details className="records-filter-panel">
            <summary>
              Filters
              {filterCount > 0 ? ` · ${filterCount} active` : ''}
            </summary>
            <div className="records-filters" aria-label="Filter records">
              <FormSelect
                label="Visibility"
                value={visibility}
                onChange={(e) => {
                  setVisibility(e.target.value);
                  setScope(emptyScope);
                  setPage(1);
                }}
                options={[
                  { value: 'all', label: 'All accessible records' },
                  { value: 'personal', label: 'My private records' },
                ]}
              />
              <FormSelect
                label="Company"
                disabled={visibility === 'personal'}
                value={scope.companyId}
                onChange={(e) => changeScope('companyId', e.target.value)}
                options={options(dir.companies, 'All companies')}
              />
              <FormSelect
                label="Division"
                disabled={!scope.companyId}
                value={scope.divisionId}
                onChange={(e) => changeScope('divisionId', e.target.value)}
                options={options(
                  dir.divisions.filter((d) => d.companyId === scope.companyId),
                  'All divisions',
                )}
              />
              <FormSelect
                label="Branch"
                disabled={!scope.divisionId}
                value={scope.branchId}
                onChange={(e) => changeScope('branchId', e.target.value)}
                options={options(
                  dir.branches.filter((b) => b.divisionId === scope.divisionId),
                  'All branches',
                )}
              />
            </div>
            <div className="records-filters records-search-filters">
              <FormSelect
                label="Status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: 'all', label: 'All active' },
                  { value: 'open', label: 'Outstanding debts' },
                  { value: 'overdue', label: 'Overdue debts' },
                  { value: 'settled', label: 'Settled debts' },
                  { value: 'void', label: 'Voided records' },
                ]}
              />
              <FormSelect
                label="Currency"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All currencies' },
                  ...['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP'].map((c) => ({
                    value: c,
                    label: c,
                  })),
                ]}
              />
              <FormDateField
                label="From"
                value={from}
                onChange={(v) => {
                  setFrom(v);
                  setPage(1);
                }}
              />
              <FormDateField
                label="To"
                value={to}
                onChange={(v) => {
                  setTo(v);
                  setPage(1);
                }}
              />
            </div>
            {filterCount > 0 && (
              <Btn
                variant="ghost"
                onClick={() => {
                  setScope(emptyScope);
                  setStatus('all');
                  setVisibility('all');
                  setCurrency('');
                  setFrom('');
                  setTo('');
                  setPage(1);
                }}
              >
                Clear filters
              </Btn>
            )}
          </details>
        </div>
        {invalidDates && (
          <p role="alert" className="records-error">
            Start date must be on or before end date.
          </p>
        )}
        {summary.error && (
          <p role="alert" className="records-error">
            {summary.error}
          </p>
        )}
        <section
          className="records-list"
          aria-label={register ? `${register.label} register` : 'Recent records'}
        >
          <div className="records-list-heading">
            <h2>{register ? `${register.label} register` : 'Recent records'}</h2>
            <span>{!list.loading && !invalidDates ? `${total} matching records` : ' '}</span>
          </div>
          {list.error ? (
            <div role="alert" className="records-empty">
              <p>{list.error}</p>
              <Btn variant="secondary" onClick={refresh}>
                Try again
              </Btn>
            </div>
          ) : invalidDates ? null : list.loading ? (
            <div role="status" className="records-empty">
              Loading records…
            </div>
          ) : !list.data?.rows.length ? (
            <div className="records-empty">
              <BookOpen size={32} />
              <h3>
                {search || from || to || status !== 'all' || scope.companyId
                  ? 'No matching records'
                  : register
                    ? `Your ${register.label.toLowerCase()} start here`
                    : 'Your notebook starts here'}
              </h3>
              <p>
                {register
                  ? `Add your first ${register.singular}, or adjust your filters.`
                  : 'Choose a register above to add a debt, transaction or note.'}
              </p>
              {manage && register && (
                <Btn onClick={() => setEditor({ mode: 'create', kind: register.kind })}>
                  Add {register.singular}
                </Btn>
              )}
            </div>
          ) : (
            <div className="records-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Outstanding</th>
                    <th>Status</th>
                    <th>Organisation</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button className="records-row-title" onClick={() => select(r.id)}>
                          {r.title}
                        </button>
                        <span>
                          {r.counterparty || registers.find((k) => k.kind === r.kind)?.label}
                          {r.reference ? ` · ${r.reference}` : ''}
                        </span>
                      </td>
                      <td data-label="Date">
                        {dateLabel(r.recordDate)}
                        {r.dueDate && <small>Due {dateLabel(r.dueDate)}</small>}
                      </td>
                      <td data-label="Amount">
                        {r.kind === 'NOTE' ? '—' : money(r.amount, r.currency)}
                      </td>
                      <td data-label="Outstanding">
                        {isDebt(r.kind) ? money(r.balance, r.currency) : '—'}
                      </td>
                      <td data-label="Status">
                        <Status value={r.status} />
                      </td>
                      <td data-label="Organisation">
                        {r.company?.name ?? 'Private'}
                        <small>
                          {[r.division?.name, r.branch?.name].filter(Boolean).join(' · ')}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <footer className="records-pagination">
            <span>
              Page {page} of {Math.max(1, Math.ceil(total / 25))}
            </span>
            <div>
              <Btn
                variant="secondary"
                aria-label="Previous page"
                disabled={page <= 1 || list.loading}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={17} />
              </Btn>
              <Btn
                variant="secondary"
                aria-label="Next page"
                disabled={page * 25 >= total || list.loading}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={17} />
              </Btn>
            </div>
          </footer>
        </section>
        {section === 'overview' && !invalidDates && (
          <section className="records-summary" aria-label="Register totals">
            {registers.map((r) => {
              const Icon = icons[r.kind],
                totals = summary.data?.filter((s) => s.kind === r.kind) ?? [];
              return (
                <article className={`records-card records-${r.colour}`} key={r.kind}>
                  <div className="records-card-top">
                    <span>
                      <Icon size={20} />
                    </span>
                    <button onClick={() => go(r.id)}>
                      {r.label}
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <p>{r.description}</p>
                  <div className="records-card-values">
                    {summary.loading ? (
                      <span>Loading…</span>
                    ) : summary.error ? (
                      <span>Unavailable</span>
                    ) : !totals.length ? (
                      <strong>—</strong>
                    ) : r.kind === 'NOTE' ? (
                      <strong>{totals.reduce((n, s) => n + s.count, 0)} notes</strong>
                    ) : (
                      totals.map((s) => (
                        <strong key={s.currency}>
                          {money(isDebt(r.kind) ? s.balance : s.amount, s.currency)}
                        </strong>
                      ))
                    )}
                  </div>
                  <div className="records-card-bottom">
                    <small>
                      {isDebt(r.kind)
                        ? 'Outstanding balance'
                        : r.kind === 'NOTE'
                          ? 'Saved information'
                          : 'Recorded total'}
                    </small>
                    {manage && (
                      <button
                        aria-label={`Add ${r.singular}`}
                        title={`Add ${r.singular}`}
                        onClick={(event) => {
                          createTrigger.current = event.currentTarget;
                          setEditor({ mode: 'create', kind: r.kind });
                        }}
                      >
                        <Plus size={17} />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
        <p className="records-footnote">
          Totals follow your filters and stay separate by currency. These registers are a record of
          information, not the group’s accounting balances.
        </p>
      </main>
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="New record"
        returnFocusRef={createTrigger}
        subtitle="What would you like to keep track of?"
        size="lg"
      >
        <div className="records-picker">
          {registers.map((r) => {
            const Icon = icons[r.kind];
            return (
              <button
                key={r.kind}
                onClick={() => {
                  setPickerOpen(false);
                  setEditor({ mode: 'create', kind: r.kind });
                }}
              >
                <Icon size={22} />
                <span>
                  <strong>{r.label}</strong>
                  <small>{r.description}</small>
                </span>
                <ChevronRight size={17} />
              </button>
            );
          })}
        </div>
      </Modal>
      <Modal
        open={!!selected && !editor}
        onClose={() => select('')}
        title={selectedEntry?.title ?? 'Record details'}
        subtitle={
          selectedEntry ? registers.find((r) => r.kind === selectedEntry.kind)?.label : undefined
        }
        placement="right"
        size="lg"
      >
        {detail.error ? (
          <p role="alert" className="records-error">
            {detail.error}
          </p>
        ) : !selectedEntry ? (
          <p role="status">Loading record…</p>
        ) : (
          <div className="records-detail">
            <div className="records-detail-top">
              <Status value={selectedEntry.status} />
              <span>{selectedEntry.company?.name ?? 'Private to you'}</span>
            </div>
            {selectedEntry.kind !== 'NOTE' && (
              <div className="records-detail-amount">
                <span>
                  {isDebt(selectedEntry.kind) ? 'Outstanding balance' : 'Recorded amount'}
                </span>
                <strong>
                  {money(
                    isDebt(selectedEntry.kind) ? selectedEntry.balance : selectedEntry.amount,
                    selectedEntry.currency,
                  )}
                </strong>
                {isDebt(selectedEntry.kind) && (
                  <small>
                    Debt amount {money(selectedEntry.amount, selectedEntry.currency)} · Paid{' '}
                    {money(selectedEntry.settledAmount, selectedEntry.currency)}
                  </small>
                )}
              </div>
            )}
            <dl>
              {[
                ['Person / business', selectedEntry.counterparty],
                ['Contact', selectedEntry.contact],
                ['Record date', dateLabel(selectedEntry.recordDate)],
                ['Due date', selectedEntry.dueDate ? dateLabel(selectedEntry.dueDate) : null],
                ['Reference', selectedEntry.reference],
                ['Category', selectedEntry.category],
                [
                  'Division / branch',
                  [selectedEntry.division?.name, selectedEntry.branch?.name]
                    .filter(Boolean)
                    .join(' / '),
                ],
              ]
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
            {selectedEntry.notes && (
              <section>
                <h3>Notes</h3>
                <p className="records-notes-text">{selectedEntry.notes}</p>
              </section>
            )}
            {selectedEntry.voidReason && (
              <p className="records-callout">Voided: {selectedEntry.voidReason}</p>
            )}
            {manage && !selectedEntry.voidedAt && (
              <div className="records-actions">
                {isDebt(selectedEntry.kind) && Number(selectedEntry.balance) > 0 && (
                  <Btn
                    onClick={() =>
                      setEditor({ mode: 'settle', kind: selectedEntry.kind, entry: selectedEntry })
                    }
                  >
                    {selectedEntry.kind === 'DEBTOR' ? 'Receive payment' : 'Pay creditor'}
                  </Btn>
                )}
                <Btn
                  variant="secondary"
                  onClick={() =>
                    setEditor({ mode: 'edit', kind: selectedEntry.kind, entry: selectedEntry })
                  }
                >
                  Edit
                </Btn>
                <Btn
                  variant="ghost"
                  disabled={Number(selectedEntry.settledAmount) > 0}
                  onClick={() =>
                    setEditor({ mode: 'void', kind: selectedEntry.kind, entry: selectedEntry })
                  }
                >
                  Void record
                </Btn>
              </div>
            )}
            {isDebt(selectedEntry.kind) && (
              <RecordsStatement
                key={selectedEntry.id}
                entry={selectedEntry}
                canExport={hasPermission('records.export')}
              />
            )}
            {isDebt(selectedEntry.kind) && (
              <section>
                <h3>Payment history</h3>
                {!selectedEntry.settlements?.length ? (
                  <p>No payments recorded yet.</p>
                ) : (
                  selectedEntry.settlements.map((s) => (
                    <div className="records-settlement" key={s.id}>
                      <div>
                        <strong>{money(s.amount, selectedEntry.currency)}</strong>
                        <small>
                          {dateLabel(s.date)}
                          {s.reference ? ` · ${s.reference}` : ''}
                        </small>
                        {s.notes && <p>{s.notes}</p>}
                        {s.reversedAt && (
                          <span className="records-callout">Reversed: {s.reversalReason}</span>
                        )}
                      </div>
                      {manage && !s.reversedAt && !selectedEntry.voidedAt && (
                        <Btn
                          variant="ghost"
                          onClick={() =>
                            setEditor({
                              mode: 'reverse',
                              kind: selectedEntry.kind,
                              entry: selectedEntry,
                              settlementId: s.id,
                            })
                          }
                        >
                          Reverse
                        </Btn>
                      )}
                    </div>
                  ))
                )}
              </section>
            )}
            <section>
              <h3>Activity</h3>
              <ol className="records-activity">
                {selectedEntry.events?.map((e) => (
                  <li key={e.id}>
                    <p>{e.detail}</p>
                    <small>
                      {e.actorName} · {dateLabel(e.createdAt)}
                    </small>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </Modal>
      {editor && (
        <RecordsEditor
          key={`${editor.mode}-${editor.kind}-${editor.entry?.id ?? 'new'}-${editor.settlementId ?? ''}`}
          editor={editor}
          scope={visibility === 'personal' ? emptyScope : scope}
          directory={dir}
          returnFocusRef={editor.mode === 'create' ? createTrigger : undefined}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className="records-status" data-status={value}>
      {value === 'partial' ? 'Partly settled' : value === 'void' ? 'Voided' : value}
    </span>
  );
}
