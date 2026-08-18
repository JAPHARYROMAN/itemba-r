'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Btn,
  Card,
  EmptyState,
  FormInput,
  FormSelect,
  PageHeader,
  SkeletonTable,
  StatCard,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendPage, backendPatch, type PaginatedResult } from '@/lib/api-client';
import {
  type ConfirmAction,
  RecordBookConfirmDialog,
  RecordBookNav,
  RecordBookPagination,
  recordBookDate,
  recordBookMoney,
} from './record-book-ui';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface ScopeOptions {
  companies: Company[];
}

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}
interface DeletedSale {
  id: string;
  recordDate: string;
  currency: string;
  totalSalesAmount: number;
  status: string;
  deletedAt: string;
  company?: Company;
  branch?: { name: string } | null;
}
interface DeletedExpense {
  id: string;
  recordDate: string;
  currency: string;
  amount: number;
  description: string;
  deletedAt: string;
  company?: Company;
  expenseCategory?: { name: string };
}
interface DeletedCategory {
  id: string;
  name: string;
  deletedAt: string;
  company?: Company;
  _count?: { expenses: number };
}

export function RecordBookTrashClient() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('record_book.view');
  const canAdmin = hasPermission('record_book.admin');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [search, setSearch] = useState('');
  const [salesPage, setSalesPage] = useState(1);
  const [expensePage, setExpensePage] = useState(1);
  const [categoryPage, setCategoryPage] = useState(1);
  const [sales, setSales] = useState<PaginatedResult<DeletedSale> | null>(null);
  const [expenses, setExpenses] = useState<PaginatedResult<DeletedExpense> | null>(null);
  const [categories, setCategories] = useState<PaginatedResult<DeletedCategory> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef(0);
  const debouncedSearch = useDebouncedValue(search);

  useEffect(() => {
    backendGet<ScopeOptions>('/record-book/scope-options')
      .then((scope) => {
        setCompanies(scope.companies);
        setCompanyId((current) => current || scope.companies[0]?.id || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load companies'));
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const base = { companyId, search: debouncedSearch, recordState: 'DELETED', limit: 20 };
      const [saleRows, expenseRows, categoryRows] = await Promise.all([
        backendPage<DeletedSale>('/record-book/daily-sales', {
          query: { ...base, page: salesPage },
        }),
        backendPage<DeletedExpense>('/record-book/expenses', {
          query: { ...base, page: expensePage },
        }),
        backendPage<DeletedCategory>('/record-book/expense-categories', {
          query: { ...base, page: categoryPage },
        }),
      ]);
      if (requestId !== requestIdRef.current) return;
      setSales(saleRows);
      setExpenses(expenseRows);
      setCategories(categoryRows);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not load Trash');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [canView, categoryPage, companyId, debouncedSearch, expensePage, salesPage]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSalesPage(1);
    setExpensePage(1);
    setCategoryPage(1);
  }, [companyId, debouncedSearch]);

  const askRestore = (
    kind: 'daily-sales' | 'expenses' | 'expense-categories',
    id: string,
    label: string,
  ) => {
    setConfirmAction({
      title: `Restore ${label}`,
      description:
        'The entry will return to the active Records Book. Existing validation rules still apply.',
      confirmLabel: 'Restore',
      tone: 'success',
      onConfirm: async () => {
        setBusy(true);
        setError('');
        try {
          await backendPatch(`/record-book/${kind}/${id}/restore`, {});
          setConfirmAction(null);
          await load();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Restore failed');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const totalDeleted = (sales?.total ?? 0) + (expenses?.total ?? 0) + (categories?.total ?? 0);

  return (
    <div className="record-book-workspace mx-auto w-full max-w-[1440px] px-4 pb-10 pt-2 sm:px-6 lg:px-8 xl:px-10">
      <PageHeader
        title="Records Book Trash"
        subtitle="Recover audit-safe soft-deleted drafts and categories"
      />
      <RecordBookNav />
      {!canAdmin && (
        <div className="mb-4 rounded-lg border border-amber-700 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          You can review deleted entries, but record_book.admin is required to restore them.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Deleted Items" value={totalDeleted} />
        <StatCard label="Daily Sales" value={sales?.total ?? 0} />
        <StatCard label="Money Out" value={expenses?.total ?? 0} />
        <StatCard label="Categories" value={categories?.total ?? 0} />
      </div>
      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,1fr)_minmax(280px,2fr)_auto] md:items-end">
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
            placeholder="All companies"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </FormSelect>
          <FormInput
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Description, category, receipt label, reference..."
          />
          <Btn variant="secondary" onClick={() => setSearch('')}>
            Reset
          </Btn>
        </div>
      </Card>

      {loading ? (
        <SkeletonTable rows={7} cols={6} />
      ) : totalDeleted === 0 ? (
        <Card>
          <EmptyState
            title="Trash is empty"
            description="Deleted draft records and categories will appear here for recovery."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Deleted Daily Sales</h2>
            {!sales?.data.length ? (
              <p className="text-sm text-slate-400">No deleted daily sales.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/70 text-left text-slate-400">
                    <tr>
                      <th className="px-3 py-3">Date</th>
                      <th className="px-3 py-3">Company / Branch</th>
                      <th className="px-3 py-3 text-right">Total</th>
                      <th className="px-3 py-3">Deleted At</th>
                      <th className="px-3 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.data.map((sale) => (
                      <tr key={sale.id} className="border-t border-slate-800">
                        <td className="px-3 py-3">{recordBookDate(sale.recordDate)}</td>
                        <td className="px-3 py-3">
                          {sale.company?.name ?? '-'}
                          <span className="block text-xs text-slate-500">
                            {sale.branch?.name ?? 'All branches'}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right font-semibold">
                          {recordBookMoney(sale.totalSalesAmount, sale.currency)}
                        </td>
                        <td className="px-3 py-3">{recordBookDate(sale.deletedAt, true)}</td>
                        <td className="px-3 py-3 text-right">
                          {canAdmin && (
                            <Btn
                              size="xs"
                              variant="success"
                              onClick={() => askRestore('daily-sales', sale.id, 'daily sales')}
                            >
                              Restore
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sales && (
              <RecordBookPagination
                page={sales.page}
                totalPages={sales.totalPages}
                total={sales.total}
                onPageChange={setSalesPage}
              />
            )}
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Deleted Money Out</h2>
            {!expenses?.data.length ? (
              <p className="text-sm text-slate-400">No deleted money-out records.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/70 text-left text-slate-400">
                    <tr>
                      <th className="px-3 py-3">Date</th>
                      <th className="px-3 py-3">Description</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3 text-right">Amount</th>
                      <th className="px-3 py-3">Deleted At</th>
                      <th className="px-3 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.data.map((expense) => (
                      <tr key={expense.id} className="border-t border-slate-800">
                        <td className="px-3 py-3">{recordBookDate(expense.recordDate)}</td>
                        <td className="px-3 py-3">{expense.description}</td>
                        <td className="px-3 py-3">{expense.expenseCategory?.name ?? '-'}</td>
                        <td className="px-3 py-3 text-right font-semibold">
                          {recordBookMoney(expense.amount, expense.currency)}
                        </td>
                        <td className="px-3 py-3">{recordBookDate(expense.deletedAt, true)}</td>
                        <td className="px-3 py-3 text-right">
                          {canAdmin && (
                            <Btn
                              size="xs"
                              variant="success"
                              onClick={() => askRestore('expenses', expense.id, 'money-out record')}
                            >
                              Restore
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {expenses && (
              <RecordBookPagination
                page={expenses.page}
                totalPages={expenses.totalPages}
                total={expenses.total}
                onPageChange={setExpensePage}
              />
            )}
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Deleted Categories</h2>
            {!categories?.data.length ? (
              <p className="text-sm text-slate-400">No deleted categories.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/70 text-left text-slate-400">
                    <tr>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">Company</th>
                      <th className="px-3 py-3">Historical Records</th>
                      <th className="px-3 py-3">Deleted At</th>
                      <th className="px-3 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.data.map((category) => (
                      <tr key={category.id} className="border-t border-slate-800">
                        <td className="px-3 py-3 font-semibold">{category.name}</td>
                        <td className="px-3 py-3">{category.company?.name ?? '-'}</td>
                        <td className="px-3 py-3">{category._count?.expenses ?? 0}</td>
                        <td className="px-3 py-3">{recordBookDate(category.deletedAt, true)}</td>
                        <td className="px-3 py-3 text-right">
                          {canAdmin && (
                            <Btn
                              size="xs"
                              variant="success"
                              onClick={() =>
                                askRestore('expense-categories', category.id, 'category')
                              }
                            >
                              Restore
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {categories && (
              <RecordBookPagination
                page={categories.page}
                totalPages={categories.totalPages}
                total={categories.total}
                onPageChange={setCategoryPage}
              />
            )}
          </Card>
        </div>
      )}
      <RecordBookConfirmDialog
        action={confirmAction}
        reason=""
        onReasonChange={() => undefined}
        busy={busy}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
}
