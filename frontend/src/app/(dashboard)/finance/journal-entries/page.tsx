'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }
interface AccountingPeriod { id: string; name: string }
interface AccountOption { id: string; accountCode: string; accountName: string }

interface JournalLine {
  id?: string;
  accountId: string;
  description?: string | null;
  debit: number;
  credit: number;
  account?: { accountCode: string; accountName: string } | null;
}

interface JournalEntry {
  id: string;
  journalNumber?: string;
  transactionDate: string;
  description: string;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  totalDebit: number;
  totalCredit: number;
  companyId: string;
  accountingPeriodId?: string | null;
  company?: { name: string } | null;
  accountingPeriod?: { name: string } | null;
  lines: JournalLine[];
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMoney(amount: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amount ?? 0);
}

function ReverseDialog({ entry, onClose, onDone }: { entry: JournalEntry; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleSubmit = async () => {
    if (!reason.trim()) { setError('Reason required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/backend/journal-entries/${entry.id}/reverse`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reversalReason: reason })
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Reverse failed'); }
      onDone();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Reverse Journal Entry" size="md"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="danger" onClick={handleSubmit} loading={saving}>Reverse</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <p className="mb-3 text-sm" style={{ color: 'var(--aurora-text)' }}>This will create a reversing entry for {entry.journalNumber ?? entry.id.slice(0, 8)}.</p>
      <FormTextarea label="Reversal Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

function JournalDrawer({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-xl overflow-y-auto shadow-xl" style={{ background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--aurora-border)' }}>
          <div>
            <h3 className="text-lg font-semibold">{entry.journalNumber ?? 'Journal Entry'}</h3>
            <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{fmtDate(entry.transactionDate)}</p>
          </div>
          <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>Company</span><div>{entry.company?.name ?? '—'}</div></div>
            <div><span className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>Period</span><div>{entry.accountingPeriod?.name ?? '—'}</div></div>
            <div><span className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>Status</span><div><StatusBadge status={entry.status} /></div></div>
            <div><span className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>Reference</span><div>{entry.referenceType ?? '—'}</div></div>
          </div>
          <div>
            <span className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>Description</span>
            <p className="text-sm mt-1">{entry.description}</p>
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2">Lines</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-2 py-2">Account</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 text-right">Debit</th>
                  <th className="px-2 py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entry.lines.map((l, i) => (
                  <tr key={l.id ?? i}>
                    <td className="px-2 py-2 font-mono">{l.account?.accountCode} — {l.account?.accountName}</td>
                    <td className="px-2 py-2">{l.description ?? '—'}</td>
                    <td className="px-2 py-2 text-right font-mono">{l.debit ? fmtMoney(l.debit) : '—'}</td>
                    <td className="px-2 py-2 text-right font-mono">{l.credit ? fmtMoney(l.credit) : '—'}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-2 py-2" colSpan={2}>Totals</td>
                  <td className="px-2 py-2 text-right font-mono">{fmtMoney(entry.totalDebit)}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmtMoney(entry.totalCredit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function JournalModal({ mode, initial, companies, onClose, onSaved }: {
  mode: 'create' | 'edit'; initial?: JournalEntry; companies: Company[]; onClose: () => void; onSaved: () => void;
}) {
  const [companyId, setCompanyId] = useState(initial?.companyId ?? '');
  const [accountingPeriodId, setAccountingPeriodId] = useState(initial?.accountingPeriodId ?? '');
  const [transactionDate, setTransactionDate] = useState(initial?.transactionDate.split('T')[0] ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [lines, setLines] = useState<JournalLine[]>(() =>
    initial?.lines?.length ? initial.lines.map((l) => ({ ...l })) : [{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }]
  );
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (companyId) {
      fetch(`/api/backend/accounting-periods?companyId=${companyId}&status=OPEN`).then((r) => r.json())
        .then((j) => setPeriods(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
      fetch(`/api/backend/chart-of-accounts?companyId=${companyId}&limit=500&isActive=true`).then((r) => r.json())
        .then((j) => setAccounts(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    }
  }, [companyId]);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  const updateLine = (idx: number, patch: Partial<JournalLine>) => {
    setLines((ls) => ls.map((l, i) => {
      if (i !== idx) return l;
      const next = { ...l, ...patch };
      if (patch.debit !== undefined && patch.debit > 0) next.credit = 0;
      if (patch.credit !== undefined && patch.credit > 0) next.debit = 0;
      return next;
    }));
  };
  const addLine = () => setLines((ls) => [...ls, { accountId: '', debit: 0, credit: 0 }]);
  const removeLine = (idx: number) => setLines((ls) => ls.length > 2 ? ls.filter((_, i) => i !== idx) : ls);

  const handleSubmit = async () => {
    if (!companyId || !transactionDate || !description.trim()) { setError('Required fields missing'); return; }
    if (!balanced) { setError('Debits must equal credits and be > 0'); return; }
    if (lines.some((l) => !l.accountId)) { setError('All lines must have an account'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        companyId, accountingPeriodId: accountingPeriodId || undefined, transactionDate, description,
        lines: lines.map((l) => ({ accountId: l.accountId, description: l.description || undefined, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      };
      const res = await fetch(
        mode === 'create' ? '/api/backend/journal-entries' : `/api/backend/journal-entries/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'Create Journal Entry' : 'Edit Journal Entry'} size="2xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={handleSubmit} loading={saving} disabled={!balanced}>{mode === 'create' ? 'Create' : 'Save Changes'}</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <FormSelect label="Company" required disabled={mode === 'edit'} value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="Select…">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
          <FormSelect label="Period" value={accountingPeriodId} onChange={(e) => setAccountingPeriodId(e.target.value)} placeholder="Auto-detect">
            {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </FormSelect>
          <FormInput label="Date" required type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
        </div>
        <FormTextarea label="Description" required rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>Lines</h4>
            <Btn variant="ghost" size="xs" onClick={addLine}>+ Add Line</Btn>
          </div>
          <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--aurora-border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-2 py-2">Account</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 text-right w-28">Debit</th>
                  <th className="px-2 py-2 text-right w-28">Credit</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">
                      <select value={l.accountId} onChange={(e) => updateLine(i, { accountId: e.target.value })}
                        className="w-full text-xs border rounded px-1 py-1" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }} disabled={!companyId}>
                        <option value="">Select…</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={l.description ?? ''} onChange={(e) => updateLine(i, { description: e.target.value })}
                        className="w-full text-xs border rounded px-1 py-1" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }} />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" step="0.01" min="0" value={l.debit || ''} onChange={(e) => updateLine(i, { debit: Number(e.target.value) || 0 })}
                        className="w-full text-xs border rounded px-1 py-1 text-right font-mono" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }} />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" step="0.01" min="0" value={l.credit || ''} onChange={(e) => updateLine(i, { credit: Number(e.target.value) || 0 })}
                        className="w-full text-xs border rounded px-1 py-1 text-right font-mono" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }} />
                    </td>
                    <td className="px-2 py-1 text-center">
                      {lines.length > 2 && <button onClick={() => removeLine(i)} className="text-red-600 hover:text-red-700 text-sm">×</button>}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-2 py-2" colSpan={2}>Totals</td>
                  <td className="px-2 py-2 text-right font-mono">{fmtMoney(totalDebit)}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmtMoney(totalCredit)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className={`mt-2 text-xs font-medium ${balanced ? 'text-emerald-600' : 'text-red-600'}`}>
            {balanced ? '✓ Balanced' : `Difference: ${fmtMoney(Math.abs(totalDebit - totalCredit))}`}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DeleteConfirm({ entry, onClose, onDeleted }: { entry: JournalEntry; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => { setDeleting(true); await fetch(`/api/backend/journal-entries/${entry.id}`, { method: 'DELETE' }); onDeleted(); };
  return (
    <Modal open onClose={onClose} title="Delete Journal Entry" size="md"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="danger" onClick={confirm} loading={deleting}>Delete</Btn></>}>
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>Delete entry <span className="font-medium">{entry.journalNumber ?? entry.id.slice(0, 8)}</span>?</p>
    </Modal>
  );
}

export default function JournalEntriesPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filterPeriods, setFilterPeriods] = useState<AccountingPeriod[]>([]);
  const [data, setData] = useState<Paginated<JournalEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [accountingPeriodId, setAccountingPeriodId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [deleting, setDeleting] = useState<JournalEntry | null>(null);
  const [reversing, setReversing] = useState<JournalEntry | null>(null);
  const [viewing, setViewing] = useState<JournalEntry | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');

  const canView = hasPermission('journal_entries.view');
  const canCreate = hasPermission('journal_entries.create');
  const canPost = hasPermission('journal_entries.post');
  const canReverse = hasPermission('journal_entries.reverse');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (companyId) {
      fetch(`/api/backend/accounting-periods?companyId=${companyId}`).then((r) => r.json())
        .then((j) => setFilterPeriods(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    } else { setFilterPeriods([]); setAccountingPeriodId(''); }
  }, [companyId]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      if (accountingPeriodId) params.set('accountingPeriodId', accountingPeriodId);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`/api/backend/journal-entries?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally { setLoading(false); }
  }, [canView, page, companyId, status, accountingPeriodId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: string) => {
    setActionMsg(''); setActionLoading(id + action);
    try {
      const res = await fetch(`/api/backend/journal-entries/${id}/${action}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Action failed'); }
      load();
    } catch (err: unknown) { setActionMsg(err instanceof Error ? err.message : 'Failed'); }
    finally { setActionLoading(null); }
  };

  const openDetail = async (id: string) => {
    const res = await fetch(`/api/backend/journal-entries/${id}`);
    const json = await res.json();
    if (json.data) setViewing(json.data);
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Journal Entries" subtitle="Manage journal entries" />
        <div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div>
      </div>
    );
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && <JournalModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <JournalModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {deleting && <DeleteConfirm entry={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); load(); }} />}
      {reversing && <ReverseDialog entry={reversing} onClose={() => setReversing(null)} onDone={() => { setReversing(null); load(); }} />}
      {viewing && <JournalDrawer entry={viewing} onClose={() => setViewing(null)} />}

      <PageHeader title="Journal Entries" subtitle="Manual ledger entries with debits and credits" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Draft" value={data?.data.filter((e) => e.status === 'DRAFT').length ?? 0} />
        <StatCard label="Posted" value={data?.data.filter((e) => e.status === 'POSTED').length ?? 0} />
        <StatCard label="Reversed" value={data?.data.filter((e) => e.status === 'REVERSED').length ?? 0} />
      </div>

      {actionMsg && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{actionMsg}</div>}

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={accountingPeriodId} onChange={(e) => { setAccountingPeriodId(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle} disabled={!companyId}>
              <option value="">All Periods</option>
              {filterPeriods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="POSTED">Posted</option>
              <option value="REVERSED">Reversed</option>
            </select>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle} title="From" />
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle} title="To" />
          </>
        }
        actions={canCreate ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Entry</Btn> : null}
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Journal #</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3 text-right">Debit</th>
                <th className="px-4 py-3 text-right">Credit</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8}><PageSpinner /></td></tr>
              ) : !data?.data.length ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No journal entries found</td></tr>
              ) : data.data.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(e.id)}>
                  <td className="px-4 py-3 font-mono text-xs">{e.journalNumber ?? e.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{fmtDate(e.transactionDate)}</td>
                  <td className="px-4 py-3 max-w-xs truncate">{e.description}</td>
                  <td className="px-4 py-3 text-xs">{e.company?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtMoney(e.totalDebit)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtMoney(e.totalCredit)}</td>
                  <td className="px-4 py-3"><StatusBadge status={e.status} /></td>
                  <td className="px-4 py-3 text-right" onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {e.status === 'DRAFT' && canCreate && (
                        <>
                          {canPost && <Btn variant="primary" size="xs" onClick={() => handleAction(e.id, 'post')} loading={actionLoading === e.id + 'post'}>Post</Btn>}
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(e)}>Edit</Btn>
                          <Btn variant="danger" size="xs" onClick={() => setDeleting(e)}>Delete</Btn>
                        </>
                      )}
                      {e.status === 'POSTED' && canReverse && (
                        <Btn variant="warning" size="xs" onClick={() => setReversing(e)}>Reverse</Btn>
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
