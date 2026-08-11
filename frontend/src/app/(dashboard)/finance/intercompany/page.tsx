'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }

interface IntercompanyTx {
  id: string;
  transactionNumber?: string;
  fromCompanyId: string;
  toCompanyId: string;
  transactionType: string;
  amount: number;
  currency: string;
  transactionDate: string;
  description: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'POSTED';
  fromCompany?: { name: string } | null;
  toCompany?: { name: string } | null;
  createdAt: string;
}

interface TxForm {
  fromCompanyId: string;
  toCompanyId: string;
  transactionType: string;
  amount: number | '';
  currency: string;
  transactionDate: string;
  description: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const BLANK_FORM: TxForm = {
  fromCompanyId: '', toCompanyId: '', transactionType: 'LOAN',
  amount: '', currency: 'TZS', transactionDate: '', description: '',
};

const TX_TYPES = ['LOAN', 'SERVICE_CHARGE', 'STOCK_TRANSFER', 'ASSET_TRANSFER', 'EXPENSE_ALLOCATION', 'PAYMENT_ON_BEHALF', 'INTERNAL_SALE', 'INTERNAL_PURCHASE', 'OTHER'];
const CURRENCIES = ['TZS', 'USD', 'EUR', 'KES', 'UGX', 'GBP'];

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function RejectDialog({ tx, onClose, onDone }: { tx: IntercompanyTx; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleSubmit = async () => {
    if (!reason.trim()) { setError('Reason required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/backend/intercompany-transactions/${tx.id}/reject`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason })
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Reject failed'); }
      onDone();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Reject Transaction" size="md"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="danger" onClick={handleSubmit} loading={saving}>Reject</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <FormTextarea label="Rejection Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

function TxModal({ mode, initial, companies, onClose, onSaved }: {
  mode: 'create' | 'edit'; initial?: IntercompanyTx; companies: Company[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<TxForm>(() => initial ? {
    fromCompanyId: initial.fromCompanyId, toCompanyId: initial.toCompanyId, transactionType: initial.transactionType,
    amount: initial.amount, currency: initial.currency, transactionDate: initial.transactionDate.split('T')[0],
    description: initial.description,
  } : { ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof TxForm>(k: K, v: TxForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.fromCompanyId || !form.toCompanyId) { setError('From/To companies required'); return; }
    if (form.fromCompanyId === form.toCompanyId) { setError('From and To must differ'); return; }
    if (!form.amount || Number(form.amount) <= 0) { setError('Valid amount required'); return; }
    if (!form.transactionDate || !form.description.trim()) { setError('Date and description required'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, amount: Number(form.amount) };
      const res = await fetch(
        mode === 'create' ? '/api/backend/intercompany-transactions' : `/api/backend/intercompany-transactions/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'Create Intercompany Transaction' : 'Edit Transaction'} size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={handleSubmit} loading={saving}>{mode === 'create' ? 'Create' : 'Save Changes'}</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormSelect label="From Company" required value={form.fromCompanyId} onChange={(e) => set('fromCompanyId', e.target.value)} placeholder="Select…">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </FormSelect>
          <FormSelect label="To Company" required value={form.toCompanyId} onChange={(e) => set('toCompanyId', e.target.value)} placeholder="Select…">
            {companies.filter((c) => c.id !== form.fromCompanyId).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </FormSelect>
        </div>
        <FormSelect label="Transaction Type" required value={form.transactionType} onChange={(e) => set('transactionType', e.target.value)}>
          {TX_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <div className="grid grid-cols-3 gap-3">
          <FormInput label="Amount" required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value === '' ? '' : Number(e.target.value))} />
          <FormSelect label="Currency" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
          <FormInput label="Date" required type="date" value={form.transactionDate} onChange={(e) => set('transactionDate', e.target.value)} />
        </div>
        <FormTextarea label="Description" required rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>
    </Modal>
  );
}

function DeleteConfirm({ tx, onClose, onDeleted }: { tx: IntercompanyTx; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => { setDeleting(true); await fetch(`/api/backend/intercompany-transactions/${tx.id}`, { method: 'DELETE' }); onDeleted(); };
  return (
    <Modal open onClose={onClose} title="Delete Transaction" size="md"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="danger" onClick={confirm} loading={deleting}>Delete</Btn></>}>
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>Delete transaction <span className="font-medium">{tx.transactionNumber ?? tx.id.slice(0, 8)}</span>?</p>
    </Modal>
  );
}

export default function IntercompanyPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<IntercompanyTx> | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCompanyId, setFromCompanyId] = useState('');
  const [toCompanyId, setToCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<IntercompanyTx | null>(null);
  const [deleting, setDeleting] = useState<IntercompanyTx | null>(null);
  const [rejecting, setRejecting] = useState<IntercompanyTx | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');

  const canView = hasPermission('intercompany.view');
  const canManage = hasPermission('intercompany.manage');
  const canApprove = hasPermission('intercompany.approve');
  const canPost = hasPermission('intercompany.post');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (fromCompanyId) params.set('fromCompanyId', fromCompanyId);
      if (toCompanyId) params.set('toCompanyId', toCompanyId);
      if (status) params.set('status', status);
      const res = await fetch(`/api/backend/intercompany-transactions?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally { setLoading(false); }
  }, [canView, page, fromCompanyId, toCompanyId, status]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: string) => {
    setActionMsg(''); setActionLoading(id + action);
    try {
      const res = await fetch(`/api/backend/intercompany-transactions/${id}/${action}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Action failed'); }
      load();
    } catch (err: unknown) {
      setActionMsg(err instanceof Error ? err.message : 'Action failed');
    } finally { setActionLoading(null); }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Intercompany Transactions" subtitle="Manage transactions" />
        <div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div>
      </div>
    );
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && <TxModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <TxModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {deleting && <DeleteConfirm tx={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); load(); }} />}
      {rejecting && <RejectDialog tx={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); load(); }} />}

      <PageHeader title="Intercompany Transactions" subtitle="Track loans, transfers, and allocations between companies" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Draft" value={data?.data.filter((t) => t.status === 'DRAFT').length ?? 0} />
        <StatCard label="Pending" value={data?.data.filter((t) => t.status === 'PENDING_APPROVAL').length ?? 0} />
        <StatCard label="Posted" value={data?.data.filter((t) => t.status === 'POSTED').length ?? 0} />
      </div>

      {actionMsg && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{actionMsg}</div>}

      <PageToolbar
        filters={
          <>
            <select value={fromCompanyId} onChange={(e) => { setFromCompanyId(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">From: All</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={toCompanyId} onChange={(e) => { setToCompanyId(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">To: All</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_APPROVAL">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="POSTED">Posted</option>
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Transaction</Btn> : null}
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Tx #</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">From → To</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7}><PageSpinner /></td></tr>
              ) : !data?.data.length ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No transactions found</td></tr>
              ) : data.data.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{tx.transactionNumber ?? tx.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{fmtDate(tx.transactionDate)}</td>
                  <td className="px-4 py-3 text-xs">{tx.fromCompany?.name ?? '—'} → {tx.toCompany?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{tx.transactionType.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-right font-mono">{tx.currency} {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(tx.amount)}</td>
                  <td className="px-4 py-3"><StatusBadge status={tx.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {tx.status === 'DRAFT' && canManage && (
                        <>
                          <Btn variant="primary" size="xs" onClick={() => handleAction(tx.id, 'submit')} loading={actionLoading === tx.id + 'submit'}>Submit</Btn>
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(tx)}>Edit</Btn>
                          <Btn variant="danger" size="xs" onClick={() => setDeleting(tx)}>Delete</Btn>
                        </>
                      )}
                      {tx.status === 'PENDING_APPROVAL' && canApprove && (
                        <>
                          <Btn variant="success" size="xs" onClick={() => handleAction(tx.id, 'approve')} loading={actionLoading === tx.id + 'approve'}>Approve</Btn>
                          <Btn variant="danger" size="xs" onClick={() => setRejecting(tx)}>Reject</Btn>
                        </>
                      )}
                      {tx.status === 'APPROVED' && canPost && (
                        <Btn variant="primary" size="xs" onClick={() => handleAction(tx.id, 'post')} loading={actionLoading === tx.id + 'post'}>Post</Btn>
                      )}
                    </div>
                  </td>
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
