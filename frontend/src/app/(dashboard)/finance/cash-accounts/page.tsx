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

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Division {
  id: string;
  name: string;
  code?: string | null;
}

interface Branch {
  id: string;
  name: string;
  code?: string | null;
  divisionId: string;
}

interface CashAccount {
  id: string;
  accountName: string;
  accountType: string;
  currency: string;
  currentBalance: number;
  openingBalance: number;
  isActive: boolean;
  linkedBankAccountId?: string | null;
  notes?: string | null;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  company?: { name: string } | null;
  division?: { name: string; code?: string | null } | null;
  branch?: { name: string; code?: string | null } | null;
  createdAt: string;
}

interface CashAccountForm {
  companyId: string;
  divisionId: string;
  branchId: string;
  accountName: string;
  accountType: string;
  currency: string;
  openingBalance: number | '';
  linkedBankAccountId: string;
  notes: string;
  isActive: boolean;
}

const BLANK_FORM: CashAccountForm = {
  companyId: '',
  divisionId: '',
  branchId: '',
  accountName: '',
  accountType: 'CASH_ON_HAND',
  currency: 'TZS',
  openingBalance: 0,
  linkedBankAccountId: '',
  notes: '',
  isActive: true,
};

const ACCOUNT_TYPES = ['CASH_ON_HAND', 'BANK', 'MOBILE_MONEY', 'PETTY_CASH', 'OTHER'];
const CURRENCIES = ['TZS', 'USD', 'EUR', 'KES', 'UGX', 'GBP'];

const TYPE_BADGE: Record<string, string> = {
  CASH_ON_HAND: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  BANK: 'bg-blue-50 text-blue-700 border-blue-200',
  MOBILE_MONEY: 'bg-purple-50 text-purple-700 border-purple-200',
  PETTY_CASH: 'bg-amber-50 text-amber-700 border-amber-200',
  OTHER: 'bg-zinc-50 text-zinc-700 border-zinc-200',
};

function fmtMoney(amount: number, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
  }).format(amount ?? 0)}`;
}

function optionLabel(row: { code?: string | null; name: string }) {
  return row.code ? `${row.code} - ${row.name}` : row.name;
}

function requiresBranchScope(accountType: string) {
  return accountType !== 'BANK';
}

function CashAccountModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: CashAccount;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CashAccountForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          divisionId: initial.divisionId ?? '',
          branchId: initial.branchId ?? '',
          accountName: initial.accountName,
          accountType: initial.accountType,
          currency: initial.currency,
          openingBalance: initial.openingBalance,
          linkedBankAccountId: initial.linkedBankAccountId ?? '',
          notes: initial.notes ?? '',
          isActive: initial.isActive,
        }
      : { ...BLANK_FORM },
  );
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof CashAccountForm>(k: K, v: CashAccountForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.companyId) {
      setDivisions([]);
      setBranches([]);
      return;
    }

    Promise.allSettled([
      fetch(`/api/backend/divisions?companyId=${form.companyId}&limit=200`).then((r) => r.json()),
      fetch(`/api/backend/branches?companyId=${form.companyId}&activeOnly=true&limit=500`).then(
        (r) => r.json(),
      ),
    ]).then(([divisionResult, branchResult]) => {
      if (divisionResult.status === 'fulfilled') {
        const rows = divisionResult.value;
        setDivisions(
          Array.isArray(rows.data?.data)
            ? rows.data.data
            : Array.isArray(rows.data)
              ? rows.data
              : [],
        );
      } else {
        setDivisions([]);
      }

      if (branchResult.status === 'fulfilled') {
        const rows = branchResult.value;
        setBranches(
          Array.isArray(rows.data?.data)
            ? rows.data.data
            : Array.isArray(rows.data)
              ? rows.data
              : [],
        );
      } else {
        setBranches([]);
      }
    });
  }, [form.companyId]);

  const branchOptions = form.divisionId
    ? branches.filter((branch) => branch.divisionId === form.divisionId)
    : [];
  const branchScopeRequired = requiresBranchScope(form.accountType);

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.accountName.trim()) {
      setError('Account name is required');
      return;
    }
    if (branchScopeRequired && (!form.divisionId || !form.branchId)) {
      setError('Division and branch/location are required for this cash account');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const body = {
        companyId: form.companyId,
        divisionId: form.divisionId,
        branchId: form.branchId,
        accountName: form.accountName.trim(),
        accountType: form.accountType,
        currency: form.currency,
        openingBalance: Number(form.openingBalance) || 0,
        linkedBankAccountId: form.accountType === 'BANK' ? form.linkedBankAccountId : '',
        notes: form.notes || undefined,
        isActive: form.isActive,
      };
      const res = await fetch(
        mode === 'create'
          ? '/api/backend/cash-accounts'
          : `/api/backend/cash-accounts/${initial!.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Save failed');
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
      title={mode === 'create' ? 'Create Cash Account' : 'Edit Cash Account'}
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
            setForm((f) => ({
              ...f,
              companyId: e.target.value,
              divisionId: '',
              branchId: '',
            }))
          }
          placeholder="Select company"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </FormSelect>

        <div className="grid grid-cols-2 gap-3">
          <FormSelect
            label="Division"
            required={branchScopeRequired}
            value={form.divisionId}
            onChange={(e) => setForm((f) => ({ ...f, divisionId: e.target.value, branchId: '' }))}
            placeholder={form.companyId ? 'Select division' : 'Select company first'}
            disabled={!form.companyId}
            hint={!branchScopeRequired ? 'Optional for bank accounts.' : undefined}
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {optionLabel(d)}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Branch / Location"
            required={branchScopeRequired}
            value={form.branchId}
            onChange={(e) => set('branchId', e.target.value)}
            placeholder={form.divisionId ? 'Select branch' : 'Select division first'}
            disabled={!form.divisionId}
            hint={!branchScopeRequired ? 'Optional for bank accounts.' : undefined}
          >
            {branchOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {optionLabel(b)}
              </option>
            ))}
          </FormSelect>
        </div>

        <FormInput
          label="Account Name"
          required
          value={form.accountName}
          onChange={(e) => set('accountName', e.target.value)}
          placeholder="e.g. Kisimani Cash Box"
        />
        <div className="grid grid-cols-2 gap-3">
          <FormSelect
            label="Account Type"
            required
            value={form.accountType}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                accountType: e.target.value,
                linkedBankAccountId: e.target.value === 'BANK' ? f.linkedBankAccountId : '',
              }))
            }
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Currency"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </FormSelect>
        </div>
        <FormInput
          label="Opening Balance"
          type="number"
          step="0.01"
          value={form.openingBalance}
          onChange={(e) =>
            set('openingBalance', e.target.value === '' ? '' : Number(e.target.value))
          }
          disabled={mode === 'edit'}
        />
        {form.accountType === 'BANK' && (
          <FormInput
            label="Linked Bank Account ID (optional)"
            value={form.linkedBankAccountId}
            onChange={(e) => set('linkedBankAccountId', e.target.value)}
            hint="Bank accounts created in Group Control are mirrored automatically."
          />
        )}
        <FormTextarea
          label="Notes"
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
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
  acc,
  onClose,
  onDeleted,
}: {
  acc: CashAccount;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => {
    setDeleting(true);
    await fetch(`/api/backend/cash-accounts/${acc.id}`, { method: 'DELETE' });
    onDeleted();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Cash Account"
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
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Delete cash account <span className="font-medium">{acc.accountName}</span>?
      </p>
    </Modal>
  );
}

export default function CashAccountsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [list, setList] = useState<CashAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [accountType, setAccountType] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CashAccount | null>(null);
  const [deleting, setDeleting] = useState<CashAccount | null>(null);

  const canView = hasPermission('cash_accounts.view');
  const canManage = hasPermission('cash_accounts.manage');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (!companyId) {
      setDivisions([]);
      setBranches([]);
      setDivisionId('');
      setBranchId('');
      return;
    }

    Promise.allSettled([
      fetch(`/api/backend/divisions?companyId=${companyId}&limit=200`).then((r) => r.json()),
      fetch(`/api/backend/branches?companyId=${companyId}&activeOnly=true&limit=500`).then((r) =>
        r.json(),
      ),
    ]).then(([divisionResult, branchResult]) => {
      if (divisionResult.status === 'fulfilled') {
        const rows = divisionResult.value;
        setDivisions(
          Array.isArray(rows.data?.data)
            ? rows.data.data
            : Array.isArray(rows.data)
              ? rows.data
              : [],
        );
      } else {
        setDivisions([]);
      }

      if (branchResult.status === 'fulfilled') {
        const rows = branchResult.value;
        setBranches(
          Array.isArray(rows.data?.data)
            ? rows.data.data
            : Array.isArray(rows.data)
              ? rows.data
              : [],
        );
      } else {
        setBranches([]);
      }
    });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      if (divisionId) params.set('divisionId', divisionId);
      if (branchId) params.set('branchId', branchId);
      if (accountType) params.set('accountType', accountType);
      if (activeFilter) params.set('isActive', activeFilter);
      const res = await fetch(`/api/backend/cash-accounts?${params}`);
      const json = await res.json();
      const arr = Array.isArray(json.data?.data)
        ? json.data.data
        : Array.isArray(json.data)
          ? json.data
          : [];
      setList(arr);
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, divisionId, branchId, accountType, activeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Cash Accounts" subtitle="Manage cash accounts" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const branchFilterOptions = divisionId
    ? branches.filter((branch) => branch.divisionId === divisionId)
    : [];
  const totalBalance = list.reduce((sum, a) => sum + (a.currentBalance ?? 0), 0);
  const distinctTypes = new Set(list.map((a) => a.accountType)).size;

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
        <CashAccountModal
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
        <CashAccountModal
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
          acc={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            load();
          }}
        />
      )}

      <PageHeader
        title="Cash Accounts"
        subtitle="Manage branch cash boxes, bank receipt accounts, and mobile money accounts"
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Accounts" value={list.length} />
        <StatCard label="Active" value={list.filter((a) => a.isActive).length} />
        <StatCard label="Total Balance" value={fmtMoney(totalBalance)} />
        <StatCard label="Account Types" value={distinctTypes} />
      </div>

      <PageToolbar
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setDivisionId('');
                setBranchId('');
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
              value={divisionId}
              onChange={(e) => {
                setDivisionId(e.target.value);
                setBranchId('');
              }}
              className={filterSelectCls}
              style={filterStyle}
              disabled={!companyId}
            >
              <option value="">All Divisions</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {optionLabel(d)}
                </option>
              ))}
            </select>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              disabled={!divisionId}
            >
              <option value="">All Branches</option>
              {branchFilterOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {optionLabel(b)}
                </option>
              ))}
            </select>
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value)}
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
              + New Account
            </Btn>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Account Name</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Division</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={canManage ? 8 : 7}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !list.length ? (
                <tr>
                  <td
                    colSpan={canManage ? 8 : 7}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No cash accounts found
                  </td>
                </tr>
              ) : (
                list.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{acc.accountName}</td>
                    <td className="px-4 py-3">{acc.company?.name ?? '-'}</td>
                    <td className="px-4 py-3">{acc.division ? optionLabel(acc.division) : '-'}</td>
                    <td className="px-4 py-3">{acc.branch ? optionLabel(acc.branch) : '-'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${
                          TYPE_BADGE[acc.accountType] ?? TYPE_BADGE.OTHER
                        }`}
                      >
                        {acc.accountType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {fmtMoney(acc.currentBalance, acc.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${
                          acc.isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                        }`}
                      >
                        {acc.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(acc)}>
                            Edit
                          </Btn>
                          <Btn variant="danger" size="xs" onClick={() => setDeleting(acc)}>
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
      </Card>
    </div>
  );
}
