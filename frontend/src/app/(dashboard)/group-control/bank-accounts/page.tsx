'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }

interface BankAccount {
  id: string;
  bankName: string;
  branchName?: string | null;
  accountName: string;
  accountNumber: string;
  accountType: string;
  currency: string;
  isActive: boolean;
  isPrimary: boolean;
  openedDate?: string | null;
  swiftCode?: string | null;
  bankAddress?: string | null;
  notes?: string | null;
  companyId?: string | null;
  company?: { id: string; name: string; code: string } | null;
  createdAt: string;
}

interface AccountSummary {
  total: number;
  active: number;
  inactive: number;
  byCompany?: { companyId: string | null; companyName: string; count: number }[];
  byCurrency?: { currency: string; count: number }[];
  byAccountType?: { accountType: string; count: number }[];
}

interface AccountForm {
  bankName: string; branchName: string; accountName: string; accountNumber: string;
  accountType: string; currency: string; isActive: boolean; isPrimary: boolean;
  openedDate: string; swiftCode: string; bankAddress: string; notes: string;
  companyId: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const ACCOUNT_TYPES = ['CURRENT', 'SAVINGS', 'FIXED_DEPOSIT', 'OVERDRAFT'];
const CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX'];

const blankForm = (): AccountForm => ({
  bankName: '', branchName: '', accountName: '', accountNumber: '',
  accountType: 'CURRENT', currency: 'TZS', isActive: true, isPrimary: false,
  openedDate: '', swiftCode: '', bankAddress: '', notes: '', companyId: '',
});

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

function AccountModal({ mode, initial, companies, onClose, onSaved }: {
  mode: 'create' | 'edit'; initial?: BankAccount; companies: Company[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<AccountForm>(() => initial ? {
    bankName: initial.bankName, branchName: initial.branchName ?? '',
    accountName: initial.accountName, accountNumber: initial.accountNumber,
    accountType: initial.accountType, currency: initial.currency,
    isActive: initial.isActive, isPrimary: initial.isPrimary,
    openedDate: initial.openedDate?.slice(0, 10) ?? '',
    swiftCode: initial.swiftCode ?? '', bankAddress: initial.bankAddress ?? '',
    notes: initial.notes ?? '', companyId: initial.companyId ?? '',
  } : blankForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setField = <K extends keyof AccountForm>(k: K, v: AccountForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.bankName.trim() || !form.accountName.trim() || !form.accountNumber.trim()) {
      setError('Bank, account name, and account number are required');
      return;
    }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        bankName: form.bankName.trim(),
        accountName: form.accountName.trim(),
        accountNumber: form.accountNumber.trim(),
        accountType: form.accountType, currency: form.currency,
        isActive: form.isActive, isPrimary: form.isPrimary,
      };
      if (form.branchName) body.branchName = form.branchName;
      if (form.openedDate) body.openedDate = form.openedDate;
      if (form.swiftCode) body.swiftCode = form.swiftCode;
      if (form.bankAddress) body.bankAddress = form.bankAddress;
      if (form.notes) body.notes = form.notes;
      if (form.companyId) body.companyId = form.companyId;
      const res = await fetch(
        mode === 'create' ? '/api/backend/bank-accounts' : `/api/backend/bank-accounts/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Bank Account' : 'Edit Bank Account'} size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={handleSubmit} loading={saving}>{mode === 'create' ? 'Create' : 'Save'}</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Bank Name" required value={form.bankName} onChange={(e) => setField('bankName', e.target.value)} />
        <FormInput label="Branch Name" value={form.branchName} onChange={(e) => setField('branchName', e.target.value)} />
        <FormInput label="Account Name" required value={form.accountName} onChange={(e) => setField('accountName', e.target.value)} />
        <FormInput label="Account Number" required value={form.accountNumber} onChange={(e) => setField('accountNumber', e.target.value)} />
        <FormSelect label="Account Type" value={form.accountType} onChange={(e) => setField('accountType', e.target.value)}>
          {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormSelect label="Currency" value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </FormSelect>
        <FormInput label="Opened Date" type="date" value={form.openedDate} onChange={(e) => setField('openedDate', e.target.value)} />
        <FormInput label="SWIFT Code" value={form.swiftCode} onChange={(e) => setField('swiftCode', e.target.value)} />
        <FormSelect label="Owning Company" value={form.companyId} onChange={(e) => setField('companyId', e.target.value)} placeholder="Group-level">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormInput label="Bank Address" value={form.bankAddress} onChange={(e) => setField('bankAddress', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => setField('isActive', e.target.checked)} /> Active
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
          <input type="checkbox" checked={form.isPrimary} onChange={(e) => setField('isPrimary', e.target.checked)} /> Primary
        </label>
      </div>
    </Modal>
  );
}

function DeleteConfirm({ account, onClose, onConfirmed }: { account: BankAccount; onClose: () => void; onConfirmed: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/backend/bank-accounts/${account.id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Delete failed'); }
      onConfirmed();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Delete Account" size="md"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="danger" onClick={handleDelete} loading={saving}>Delete</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>Delete <strong>{account.bankName}</strong> account <strong>{account.accountNumber}</strong>?</p>
    </Modal>
  );
}

export default function BankAccountsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<BankAccount> | null>(null);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterCurrency, setFilterCurrency] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [page, setPage] = useState(1);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [deleting, setDeleting] = useState<BankAccount | null>(null);

  // Permission codes match the seed: `bank-accounts.{read|create|update|delete|approve}`.
  // (Earlier copy-paste bug had this checking `contracts.view` / `documents.manage`,
  // which silently denied access to every user — including super-admins.)
  const canView = hasPermission('bank-accounts.read');
  const canManage = hasPermission('bank-accounts.create');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const loadSummary = useCallback(() => {
    fetch('/api/backend/bank-accounts/summary').then((r) => r.json()).then((j) => setSummary(j.data ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search.trim()) params.set('search', search.trim());
      if (filterCompany) params.set('companyId', filterCompany);
      if (filterType) params.set('accountType', filterType);
      if (filterCurrency) params.set('currency', filterCurrency);
      if (filterActive) params.set('isActive', filterActive);
      const res = await fetch(`/api/backend/bank-accounts?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally { setLoading(false); }
  }, [page, search, filterCompany, filterType, filterCurrency, filterActive]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { load(); }, [load]);

  if (!canView) {
    return <div className="p-6"><PageHeader title="Bank Accounts" subtitle="Group bank account registry" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;

  const refresh = () => { load(); loadSummary(); };

  return (
    <div className="p-6 space-y-6">
      {creating && <AccountModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />}
      {editing && <AccountModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {deleting && <DeleteConfirm account={deleting} onClose={() => setDeleting(null)} onConfirmed={() => { setDeleting(null); refresh(); }} />}

      <PageHeader title="Bank Accounts" subtitle="Group-wide bank account registry — currency, ownership, and primary flag" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total Accounts" value={summary?.total ?? 0} />
        <StatCard label="Active" value={summary?.active ?? 0} hint="Currently in use" />
        <StatCard label="Inactive" value={summary?.inactive ?? 0} hint="Dormant" />
        <StatCard label="Companies" value={summary?.byCompany?.length ?? 0} />
        <StatCard label="Currencies" value={summary?.byCurrency?.length ?? 0} />
      </div>

      {summary?.byAccountType?.length ? (
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>By Account Type</h3>
          <div className="flex flex-wrap gap-2">
            {summary.byAccountType.map((row, i) => (
              <span key={i} className="text-xs px-3 py-1.5 rounded-full border" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}>
                {row.accountType.replace(/_/g, ' ')} <strong className="ml-1">{row.count}</strong>
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <PageToolbar
        search={search} onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Bank, account name, number…"
        filters={
          <>
            <select value={filterCompany} onChange={(e) => { setFilterCompany(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Types</option>
              {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterCurrency} onChange={(e) => { setFilterCurrency(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Currencies</option>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterActive} onChange={(e) => { setFilterActive(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Account</Btn> : null}
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Bank</th>
                <th className="px-4 py-3">Account Name</th>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Opened</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={canManage ? 9 : 8}><PageSpinner /></td></tr>
                : !data?.data.length ? <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No accounts</td></tr>
                : data.data.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div>{a.bankName}</div>
                      {a.branchName && <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{a.branchName}</div>}
                    </td>
                    <td className="px-4 py-3">{a.accountName}{a.isPrimary && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Primary</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs">{a.accountNumber}</td>
                    <td className="px-4 py-3 text-xs">{a.accountType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-xs">{a.currency}</td>
                    <td className="px-4 py-3 text-xs">{a.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{fmtDate(a.openedDate)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${a.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                        {a.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right space-x-1">
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(a)}>Edit</Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(a)}>Delete</Btn>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--aurora-border)' }}>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Page {data.page} of {data.totalPages} · {data.total} total</span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
              <Btn variant="secondary" size="xs" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
