'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }

interface Account {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  accountSubType?: string | null;
  parentAccountId?: string | null;
  parentAccount?: { accountCode: string; accountName: string } | null;
  description?: string | null;
  isActive: boolean;
  companyId: string;
  company?: { name: string } | null;
  createdAt: string;
}

interface AccountForm {
  companyId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  accountSubType: string;
  parentAccountId: string;
  description: string;
  isActive: boolean;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const BLANK_FORM: AccountForm = {
  companyId: '', accountCode: '', accountName: '', accountType: 'ASSET',
  accountSubType: '', parentAccountId: '', description: '', isActive: true,
};

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'COST_OF_GOODS_SOLD'];

const TYPE_BADGE: Record<string, string> = {
  ASSET: 'bg-blue-50 text-blue-700 border-blue-200',
  LIABILITY: 'bg-orange-50 text-orange-700 border-orange-200',
  EQUITY: 'bg-purple-50 text-purple-700 border-purple-200',
  INCOME: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EXPENSE: 'bg-red-50 text-red-700 border-red-200',
  COST_OF_GOODS_SOLD: 'bg-amber-50 text-amber-700 border-amber-200',
};

function AccountModal({ mode, initial, companies, onClose, onSaved }: {
  mode: 'create' | 'edit'; initial?: Account; companies: Company[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<AccountForm>(() => initial ? {
    companyId: initial.companyId, accountCode: initial.accountCode, accountName: initial.accountName,
    accountType: initial.accountType, accountSubType: initial.accountSubType ?? '',
    parentAccountId: initial.parentAccountId ?? '', description: initial.description ?? '', isActive: initial.isActive,
  } : { ...BLANK_FORM });
  const [parents, setParents] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof AccountForm>(k: K, v: AccountForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (form.companyId) {
      fetch(`/api/backend/chart-of-accounts?companyId=${form.companyId}&limit=500&isActive=true`)
        .then((r) => r.json())
        .then((j) => {
          const arr = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
          setParents(arr.filter((a: Account) => a.id !== initial?.id));
        });
    }
  }, [form.companyId, initial?.id]);

  const handleSubmit = async () => {
    if (!form.companyId || !form.accountCode.trim() || !form.accountName.trim()) { setError('Required fields missing'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, accountSubType: form.accountSubType || undefined, parentAccountId: form.parentAccountId || undefined, description: form.description || undefined };
      const res = await fetch(
        mode === 'create' ? '/api/backend/chart-of-accounts' : `/api/backend/chart-of-accounts/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'Create Account' : 'Edit Account'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={handleSubmit} loading={saving}>{mode === 'create' ? 'Create' : 'Save Changes'}</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        <FormSelect label="Company" required disabled={mode === 'edit'} value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select company…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
        </FormSelect>
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Account Code" required value={form.accountCode} onChange={(e) => set('accountCode', e.target.value)} placeholder="e.g. 1000" />
          <FormSelect label="Account Type" required value={form.accountType} onChange={(e) => set('accountType', e.target.value)}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </FormSelect>
        </div>
        <FormInput label="Account Name" required value={form.accountName} onChange={(e) => set('accountName', e.target.value)} placeholder="e.g. Cash on Hand" />
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Sub Type" value={form.accountSubType} onChange={(e) => set('accountSubType', e.target.value)} placeholder="Optional" />
          <FormSelect label="Parent Account" value={form.parentAccountId} onChange={(e) => set('parentAccountId', e.target.value)} placeholder="None" disabled={!form.companyId}>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.accountCode} — {p.accountName}</option>)}
          </FormSelect>
        </div>
        <FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} className="rounded" />
          Active
        </label>
      </div>
    </Modal>
  );
}

function DeleteConfirm({ acc, onClose, onDeleted }: { acc: Account; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => { setDeleting(true); await fetch(`/api/backend/chart-of-accounts/${acc.id}`, { method: 'DELETE' }); onDeleted(); };
  return (
    <Modal open onClose={onClose} title="Delete Account" size="md"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="danger" onClick={confirm} loading={deleting}>Delete</Btn></>}>
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>Delete account <span className="font-medium">{acc.accountCode} — {acc.accountName}</span>?</p>
    </Modal>
  );
}

export default function ChartOfAccountsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<Account> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [accountType, setAccountType] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  const canView = hasPermission('chart_of_accounts.view');
  const canManage = hasPermission('chart_of_accounts.manage');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (companyId) params.set('companyId', companyId);
      if (accountType) params.set('accountType', accountType);
      if (activeFilter) params.set('isActive', activeFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/backend/chart-of-accounts?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally { setLoading(false); }
  }, [canView, page, companyId, accountType, activeFilter, search]);

  useEffect(() => { load(); }, [load]);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Chart of Accounts" subtitle="Manage chart of accounts" />
        <div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div>
      </div>
    );
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && <AccountModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <AccountModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {deleting && <DeleteConfirm acc={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); load(); }} />}

      <PageHeader title="Chart of Accounts" subtitle="Define account hierarchy for ledger" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Accounts" value={data?.total ?? 0} />
        <StatCard label="Active" value={data?.data.filter((a) => a.isActive).length ?? 0} />
        <StatCard label="Asset Accounts" value={data?.data.filter((a) => a.accountType === 'ASSET').length ?? 0} />
        <StatCard label="Liability Accounts" value={data?.data.filter((a) => a.accountType === 'LIABILITY').length ?? 0} />
      </div>

      <PageToolbar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Search code or name…"
        filters={
          <>
            <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={accountType} onChange={(e) => { setAccountType(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Types</option>
              {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={activeFilter} onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
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
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Parent</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7}><PageSpinner /></td></tr>
              ) : !data?.data.length ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No accounts found</td></tr>
              ) : data.data.map((acc) => (
                <tr key={acc.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{acc.accountCode}</td>
                  <td className="px-4 py-3 font-medium">{acc.accountName}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${TYPE_BADGE[acc.accountType] ?? ''}`}>
                      {acc.accountType.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                    {acc.parentAccount ? `${acc.parentAccount.accountCode} — ${acc.parentAccount.accountName}` : '—'}
                  </td>
                  <td className="px-4 py-3">{acc.company?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${acc.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}>
                      {acc.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(acc)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleting(acc)}>Delete</Btn>
                      </div>
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
