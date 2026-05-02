'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Modal, Btn, PageToolbar, FormInput, FormSelect, FormTextarea, DateInput, PageSpinner, StatusBadge, ConfirmDialog } from '@/components/ui';

const EXPENSE_TYPES = ['FUEL','TOLL','ACCOMMODATION','FOOD','LOADING','OFFLOADING','REPAIR','VEHICLE_WASH','PARKING','BORDER_CROSSING','PORT_CHARGES','OTHER'];

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

interface Company { id: string; name: string; code: string; }
interface Division { id: string; name: string; code: string; }

function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtCurrency(n: number, cur = 'TZS') { return `${cur} ${new Intl.NumberFormat('en-US').format(n)}`; }

const EMPTY_FORM = { tripId: '', expenseType: 'FUEL', amount: '', currency: 'TZS', expenseDate: '', description: '' };

export default function TripExpensesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [trips, setTrips] = useState<any[]>([]);
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<null | 'create' | Record<string, any>>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLabel, setDeleteLabel] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])
    );
  }, []);

  useEffect(() => {
    if (!companyId) { setDivisions([]); setDivisionId(''); setTrips([]); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=50`)
      .then(r => r.json())
      .then(j => {
        const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
        setDivisions(divs);
        if (divs.length > 0) setDivisionId(divs[0].id);
        else setDivisionId('');
      });
    fetch(`/api/backend/logistics/trips?companyId=${companyId}&limit=100`)
      .then(r => r.json())
      .then(j => setTrips(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, [companyId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/logistics/trip-expenses?companyId=${companyId}&page=1&limit=20`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setModal('create');
  }

  function openEdit(row: any) {
    setForm({
      tripId: row.tripId ?? '',
      expenseType: row.expenseType ?? 'FUEL',
      amount: row.amount ?? '',
      currency: row.currency ?? 'TZS',
      expenseDate: row.expenseDate ? row.expenseDate.slice(0, 10) : '',
      description: row.description ?? '',
    });
    setModal(row);
  }

  async function handleSave() {
    if (!form.tripId || !form.expenseType || !form.amount || !form.expenseDate) {
      alert('Trip ID, Expense Type, Amount, and Date are required.');
      return;
    }
    setSaving(true);
    try {
      const isEdit = modal !== null && typeof modal !== 'string';
      const url = isEdit ? `/api/backend/logistics/trip-expenses/${(modal as any).id}` : '/api/backend/logistics/trip-expenses';
      const method = isEdit ? 'PUT' : 'POST';
      const body = { ...form, amount: Number(form.amount), companyId, divisionId };
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message ?? 'Save failed'); }
      setModal(null);
      await load();
      setToast({ message: 'Expense saved successfully.', type: 'success' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setToast({ message: 'Failed to save Expense.', type: 'error' });
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/backend/logistics/trip-expenses/${deleteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      });
      if (!res.ok) throw new Error('Delete failed');
      setToast({ message: `${deleteLabel} deleted successfully.`, type: 'success' });
      await load();
    } catch {
      setToast({ message: `Failed to delete ${deleteLabel}.`, type: 'error' });
    } finally { setDeleteId(null); }
  }

  const isEdit = modal !== null && typeof modal !== 'string';

  return (
    <div className="p-6 space-y-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      <PageHeader title="Trip Expenses" subtitle="Expense records per trip" />

      <PageToolbar
        filters={
          <select
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            style={{ color: 'var(--aurora-text)' }}
          >
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        }
        actions={companyId ? <Btn onClick={openCreate}>+ New Expense</Btn> : undefined}
      />

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} expenses</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Expense #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Trip #</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Expense Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Amount</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Currency</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Description</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No expenses found.</td></tr>
                ) : data.data.map((e: any) => (
                  <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{e.expenseNumber ?? e.id?.slice(0, 8)}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{e.trip?.tripNumber ?? e.tripId ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{e.expenseType?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{e.amount != null ? fmtCurrency(e.amount, e.currency) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{e.currency ?? 'TZS'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{e.expenseDate ? fmtDate(e.expenseDate) : '—'}</td>
                    <td className={`${tdCls} max-w-xs truncate`} style={{ color: 'var(--aurora-text)' }}>{e.description ?? '—'}</td>
                    <td className={tdCls}>
                      <div className="flex gap-3">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(e)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => { setDeleteId(e.id); setDeleteLabel(e.expenseNumber || e.id?.slice(0, 8)); }}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={isEdit ? 'Edit Expense' : 'New Expense'}
        size="md"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setModal(null)}>Cancel</Btn>
            <Btn loading={saving} onClick={handleSave}>Save</Btn>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormSelect className="sm:col-span-2" label="Trip" value={form.tripId} onChange={e => setForm(f => ({ ...f, tripId: e.target.value }))} required placeholder="— Select Trip —">
            {trips.map(t => <option key={t.id} value={t.id}>{t.tripNumber} – {t.origin} → {t.destination}</option>)}
          </FormSelect>
          <FormSelect label="Expense Type" value={form.expenseType} onChange={e => setForm(f => ({ ...f, expenseType: e.target.value }))} required>
            {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormInput label="Amount" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" min="0" required />
          <FormInput label="Currency" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} placeholder="TZS" />
          <DateInput label="Expense Date" value={form.expenseDate} onChange={e => setForm(f => ({ ...f, expenseDate: e.target.value }))} required />
          {divisions.length > 1 && (
            <FormSelect label="Division" value={divisionId} onChange={e => setDivisionId(e.target.value)}>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </FormSelect>
          )}
          <FormTextarea className="sm:col-span-2" label="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes…" rows={3} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Expense"
        message={`Are you sure you want to delete expense "${deleteLabel}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
