'use client';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, Receipt, Search } from 'lucide-react';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { Btn, FormDateField } from '@/components/ui';
import {
  Account,
  ExpenseReport,
  Movement,
  Scope,
  dateLabel,
  expenseCategories,
  localToday,
  money,
} from './types';

export function CashExpenses({
  scope,
  accounts,
  revision,
  onSelect,
  onSuppliers,
  onAccounts,
}: {
  scope: Scope;
  accounts: Account[];
  revision: number;
  onSelect: (row: Movement) => void;
  onSuppliers: () => void;
  onAccounts?: () => void;
}) {
  const [from, setFrom] = useState(() => localToday().slice(0, 7) + '-01'),
    [to, setTo] = useState(localToday),
    [category, setCategory] = useState(''),
    [accountId, setAccountId] = useState(''),
    [status, setStatus] = useState('all'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [currency, setCurrency] = useState('');
  const deferred = useDeferredValue(search);
  const invalid = !!from && !!to && from > to;
  const report = useWorkspaceResource<ExpenseReport>(
    '/cash-desk/expenses',
    {
      ...Object.fromEntries(Object.entries(scope).filter(([, v]) => v)),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(category ? { expenseCategory: category } : {}),
      ...(accountId ? { accountId } : {}),
      status,
      search: deferred,
      page,
    },
    !invalid,
  );
  const { reload } = report;
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current !== revision) {
      previousRevision.current = revision;
      reload();
    }
  }, [revision, reload]);
  const totals = report.data?.currencies ?? [],
    current = totals.find((c) => c.currency === currency) ?? totals[0];
  const filters = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };
  return (
    <section className="cash-expenses" aria-label="Expense management">
      <div className="cash-expense-intro">
        <Receipt size={18} />
        <p>
          Everyday spending, in one place.
          <span>These are expenses already paid from your accounts.</span>
        </p>
        <button onClick={onSuppliers}>
          Pay a supplier invoice <ChevronRight size={14} />
        </button>
      </div>
      <div className="cash-toolbar cash-expense-filters">
        <div className="ui-date-caption">
          From{' '}
          <FormDateField
            aria-label="Expenses from"
            value={from}
            onChange={(value) => filters(setFrom, value)}
            className="ui-date-field-inline"
          />
        </div>
        <div className="ui-date-caption">
          To{' '}
          <FormDateField
            aria-label="Expenses to"
            value={to}
            onChange={(value) => filters(setTo, value)}
            className="ui-date-field-inline"
          />
        </div>
        <select
          aria-label="Filter expense category"
          value={category}
          onChange={(e) => filters(setCategory, e.target.value)}
        >
          <option value="">All categories</option>
          {Object.entries(expenseCategories).map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
          <option value="UNCATEGORIZED">Uncategorized (earlier records)</option>
        </select>
        <select
          aria-label="Filter expense account"
          value={accountId}
          onChange={(e) => filters(setAccountId, e.target.value)}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option value={a.id} key={a.id}>
              {a.name} · {a.company.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Expense status"
          value={status}
          onChange={(e) => filters(setStatus, e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="reversed">Reversed</option>
        </select>
        <label className="cash-search">
          <Search size={16} />
          <input
            aria-label="Search expenses"
            placeholder="Search payee, description or reference"
            value={search}
            onChange={(e) => filters(setSearch, e.target.value)}
          />
        </label>
      </div>
      {invalid ? (
        <p className="desk-error" role="alert">
          The start date must be on or before the end date.
        </p>
      ) : report.error ? (
        <p className="desk-error" role="alert">
          {report.error} <button onClick={reload}>Retry</button>
        </p>
      ) : report.loading ? (
        <p role="status" className="desk-pad desk-muted">
          Loading expenses…
        </p>
      ) : (
        <>
          {!!totals.length && (
            <>
              <div className="cash-section-title">
                <h2>Spending summary</h2>
                <label className="cash-expense-currency">
                  Currency{' '}
                  <select
                    aria-label="Expense summary currency"
                    value={current?.currency ?? ''}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    {totals.map((c) => (
                      <option key={c.currency}>{c.currency}</option>
                    ))}
                  </select>
                </label>
              </div>
              {current && (
                <div className="cash-stats">
                  <div className="cash-balance">
                    <span>
                      <ArrowUpRight size={17} /> Paid expenses
                    </span>
                    <strong>{money(current.paid, current.currency)}</strong>
                    <small>Excludes reversed records</small>
                  </div>
                  <div>
                    <span>Reversed expenses</span>
                    <strong>{money(current.reversed, current.currency)}</strong>
                    <small>Kept in the history for reference</small>
                  </div>
                  <div>
                    <span>Matching records</span>
                    <strong>{current.count}</strong>
                    <small>{current.currency} · Across all result pages</small>
                  </div>
                </div>
              )}
              {current && Object.keys(current.categories).length > 0 && (
                <div className="cash-expense-breakdown" aria-label="Spending by category">
                  {Object.entries(current.categories).map(([key, value]) => (
                    <div key={key}>
                      <span>{expenseCategories[key] ?? 'Uncategorized'}</span>
                      <strong>{money(value, current.currency)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="cash-section-title">
            <h2>Expense register</h2>
            <span className="desk-muted">{report.data?.total ?? 0} records</span>
          </div>
          {!report.data?.rows.length ? (
            <div className="cash-empty">
              <span>
                <Receipt size={28} />
              </span>
              <h2>No expenses in this view</h2>
              <p>
                {accounts.length
                  ? 'Record an expense using the button above, or adjust the dates and filters to find earlier spending.'
                  : 'Set up a cash, bank or mobile money account with its opening balance before recording expenses.'}
              </p>
              {!accounts.length && onAccounts && (
                <Btn variant="secondary" onClick={onAccounts}>
                  Go to accounts
                </Btn>
              )}
            </div>
          ) : (
            <div className="cash-movements cash-expense-register">
              {report.data.rows.map((row) => (
                <button key={row.id} onClick={() => onSelect(row)}>
                  <span className="cash-movement-icon">
                    <ArrowUpRight size={18} />
                  </span>
                  <span className="cash-movement-name">
                    <strong>{row.payee || row.description}</strong>
                    <small>
                      {row.payee ? `${row.description} · ` : ''}
                      {expenseCategories[row.expenseCategory ?? ''] ?? 'Uncategorized'} ·{' '}
                      {row.entries.map((e) => e.account.name).join(', ')}
                    </small>
                  </span>
                  <span className={`cash-expense-status ${row.reversedAt ? 'is-reversed' : ''}`}>
                    {row.reversedAt ? 'Reversed' : 'Paid'}
                  </span>
                  <span className="cash-movement-date">{dateLabel(row.businessDate)}</span>
                  <strong className="cash-movement-amount">
                    {money(row.amount, row.currency)}
                  </strong>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          )}
          {!!report.data && (report.data.total > 25 || page > 1) && (
            <div className="desk-pagination">
              <span>
                Page {page} of {Math.max(1, Math.ceil(report.data.total / 25))}
              </span>
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <button
                disabled={page * 25 >= report.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
