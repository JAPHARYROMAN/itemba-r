'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  PageSpinner,
  PageToolbar,
  StatCard,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendDelete, backendPatch, backendPost } from '@/lib/api-client';
import { unwrapList } from '@/lib/unwrap';

export interface Company {
  id: string;
  name: string;
  code: string;
}

export interface Account {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  isActive: boolean;
  companyId: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description?: string | null;
  linkedAccountId?: string | null;
  isActive: boolean;
  companyId: string;
  company?: { id: string; name: string; code: string } | null;
  createdAt: string;
}

interface CategoryForm {
  companyId: string;
  name: string;
  description: string;
  linkedAccountId: string;
  isActive: boolean;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

// pay() posts a debit to the linked expense ledger, so only expense-natured
// accounts make sense as a target.
const EXPENSE_ACCOUNT_TYPES = ['EXPENSE', 'COST_OF_GOODS_SOLD'];

const BLANK_FORM: CategoryForm = {
  companyId: '',
  name: '',
  description: '',
  linkedAccountId: '',
  isActive: true,
};

export function CategoryModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: ExpenseCategory;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CategoryForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          name: initial.name,
          description: initial.description ?? '',
          linkedAccountId: initial.linkedAccountId ?? '',
          isActive: initial.isActive,
        }
      : { ...BLANK_FORM },
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof CategoryForm>(k: K, v: CategoryForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Load the selected company's expense chart-of-accounts for the GL selector.
  // The backend caps chart-of-accounts page size at 200.
  useEffect(() => {
    if (!form.companyId) {
      setAccounts([]);
      return;
    }
    let cancelled = false;
    setAccountsLoading(true);
    fetch(
      `/api/backend/chart-of-accounts?companyId=${encodeURIComponent(form.companyId)}&isActive=true&limit=200`,
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setAccounts(
          unwrapList<Account>(j).filter((a) => EXPENSE_ACCOUNT_TYPES.includes(a.accountType)),
        );
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  // NOTE: the linked account is intentionally NOT auto-cleared when it is
  // missing from the fetched active-expense-account list — that silently
  // dropped a category's posting link on any unrelated edit (e.g. a rename)
  // whenever the linked account had been deactivated. The link only changes
  // when the user explicitly selects something else, or when the company
  // changes in create mode (handled on the company select itself); a missing
  // account is kept round-trippable via a synthetic option below.

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (mode === 'create') {
        await backendPost('/expense-categories', {
          companyId: form.companyId,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          linkedAccountId: form.linkedAccountId || undefined,
          isActive: form.isActive,
        });
      } else {
        // companyId is immutable after creation and not part of the update flow.
        // Blank optionals go as null so an edit can CLEAR them (the update DTO
        // is a PartialType and @IsOptional() skips null).
        await backendPatch(`/expense-categories/${initial!.id}`, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          linkedAccountId: form.linkedAccountId || null,
          isActive: form.isActive,
        });
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Expense Category' : 'Edit Expense Category'}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <FormSelect
          label="Company"
          required
          disabled={mode === 'edit'}
          value={form.companyId}
          onChange={(e) =>
            // A previously chosen account belongs to the old company, so a
            // company change (create mode only — the select is disabled when
            // editing) is the one place the link is cleared automatically.
            setForm((f) => ({ ...f, companyId: e.target.value, linkedAccountId: '' }))
          }
          placeholder="Select company"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Office Supplies"
        />
        <FormSelect
          label="Linked GL Account"
          value={form.linkedAccountId}
          onChange={(e) => set('linkedAccountId', e.target.value)}
          placeholder={
            form.companyId
              ? accountsLoading
                ? 'Loading accounts…'
                : 'None'
              : 'Select a company first'
          }
          disabled={!form.companyId || accountsLoading}
          hint="Expense account debited when an expense in this category is paid. Required before payment can post to the ledger."
        >
          {/* Keep the select round-trippable when the current link is absent
              from the fetched list (deactivated or non-expense-typed account):
              a synthetic option preserves the existing posting link so an
              unrelated edit never drops it — only an explicit selection does. */}
          {form.linkedAccountId && !accounts.some((a) => a.id === form.linkedAccountId) && (
            <option value={form.linkedAccountId}>Current account (inactive or unavailable)</option>
          )}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountCode} — {a.accountName}
            </option>
          ))}
        </FormSelect>
        <FormTextarea
          label="Description"
          rows={2}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Optional"
        />
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            className="rounded"
          />
          Active
        </label>
      </div>
    </Modal>
  );
}

function DeleteConfirm({
  cat,
  onClose,
  onDeleted,
}: {
  cat: ExpenseCategory;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    setDeleting(true);
    setError('');
    try {
      await backendDelete(`/expense-categories/${cat.id}`);
      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Expense Category"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={confirm} loading={deleting}>
            Delete
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Delete expense category <span className="font-medium">{cat.name}</span>?
      </p>
    </Modal>
  );
}

export default function ExpenseCategoriesPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accountsById, setAccountsById] = useState<Record<string, Account>>({});
  const [data, setData] = useState<Paginated<ExpenseCategory> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [deleting, setDeleting] = useState<ExpenseCategory | null>(null);

  // View mirrors the backend read guard (expenses.view); manage mirrors the
  // write guard (chart_of_accounts.manage) on create/update/delete.
  const canView = hasPermission('expenses.view');
  const canManage = hasPermission('chart_of_accounts.manage');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(unwrapList<Company>(j)))
      .catch(() => setCompanies([]));
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (companyId) params.set('companyId', companyId);
      if (activeFilter) params.set('isActive', activeFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/backend/expense-categories?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, activeFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolve linked-account codes/names for display. Only fetched when a single
  // company is filtered (the list can otherwise span many companies).
  useEffect(() => {
    if (!canView || !companyId) {
      setAccountsById({});
      return;
    }
    let cancelled = false;
    fetch(`/api/backend/chart-of-accounts?companyId=${encodeURIComponent(companyId)}&limit=200`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const map: Record<string, Account> = {};
        for (const a of unwrapList<Account>(j)) map[a.id] = a;
        setAccountsById(map);
      })
      .catch(() => {
        if (!cancelled) setAccountsById({});
      });
    return () => {
      cancelled = true;
    };
  }, [canView, companyId]);

  const renderLinkedAccount = (cat: ExpenseCategory) => {
    if (!cat.linkedAccountId) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs border bg-amber-50 text-amber-700 border-amber-200">
          Not linked
        </span>
      );
    }
    const acc = accountsById[cat.linkedAccountId];
    if (acc) {
      return (
        <span className="font-mono text-xs">
          {acc.accountCode} — {acc.accountName}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs border bg-emerald-50 text-emerald-700 border-emerald-200">
        Linked
      </span>
    );
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Expense Categories" subtitle="Manage expense categories" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <CategoryModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <CategoryModal
          mode="edit"
          initial={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          cat={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            load();
          }}
        />
      )}

      <PageHeader
        title="Expense Categories"
        subtitle="Categorise expenses and link each to a GL account"
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Active" value={data?.data.filter((c) => c.isActive).length ?? 0} />
        <StatCard
          label="Linked"
          value={data?.data.filter((c) => !!c.linkedAccountId).length ?? 0}
        />
        <StatCard
          label="Not Linked"
          value={data?.data.filter((c) => !c.linkedAccountId).length ?? 0}
        />
      </div>

      <PageToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search name or description…"
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={activeFilter}
              onChange={(e) => {
                setActiveFilter(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </>
        }
        actions={
          canManage ? (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Category
            </Btn>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Linked GL Account</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No expense categories found
                  </td>
                </tr>
              ) : (
                data.data.map((cat) => (
                  <tr key={cat.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">
                      {cat.name}
                      {cat.description && (
                        <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {cat.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">{cat.company?.name ?? '—'}</td>
                    <td className="px-4 py-3">{renderLinkedAccount(cat)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${
                          cat.isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                        }`}
                      >
                        {cat.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(cat)}>
                            Edit
                          </Btn>
                          <Btn variant="danger" size="xs" onClick={() => setDeleting(cat)}>
                            Delete
                          </Btn>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div
            className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={data ? page >= data.totalPages : true}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
