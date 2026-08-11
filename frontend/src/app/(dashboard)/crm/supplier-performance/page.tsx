'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageSpinner, PageToolbar, Modal, Btn, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { backendPost, backendPut, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface SupplierOption { id: string; name: string }

interface SupplierPerf {
  id: string;
  companyId: string;
  company?: { name: string };
  supplierId: string;
  rating: string;
  onTimeDeliveryRate?: number | string | null;
  qualityScore?: number | string | null;
  priceCompetitivenessScore?: number | string | null;
  totalPurchases: number;
  totalReturns?: number;
  disputeCount?: number;
  notes?: string | null;
}

const RATINGS = ['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR', 'BLOCKED', 'UNKNOWN'];

const RATING_CLS: Record<string, string> = {
  EXCELLENT: 'bg-green-100 text-green-700',
  GOOD: 'bg-green-100 text-green-700',
  AVERAGE: 'bg-yellow-100 text-yellow-700',
  POOR: 'bg-red-100 text-red-700',
  BLOCKED: 'bg-red-100 text-red-700',
  UNKNOWN: 'bg-gray-100 text-gray-600',
};

interface PerfForm {
  companyId: string; supplierId: string; rating: string;
  onTimeDeliveryRate: string; qualityScore: string; priceCompetitivenessScore: string;
  totalPurchases: string; totalReturns: string; disputeCount: string; notes: string;
}
const BLANK: PerfForm = {
  companyId: '', supplierId: '', rating: 'UNKNOWN',
  onTimeDeliveryRate: '', qualityScore: '', priceCompetitivenessScore: '',
  totalPurchases: '', totalReturns: '', disputeCount: '', notes: '',
};

function PerfModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: SupplierPerf; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<PerfForm>(() => initial ? {
    companyId: initial.companyId, supplierId: initial.supplierId,
    rating: initial.rating ?? 'UNKNOWN',
    onTimeDeliveryRate: initial.onTimeDeliveryRate != null ? String(initial.onTimeDeliveryRate) : '',
    qualityScore: initial.qualityScore != null ? String(initial.qualityScore) : '',
    priceCompetitivenessScore: initial.priceCompetitivenessScore != null ? String(initial.priceCompetitivenessScore) : '',
    totalPurchases: initial.totalPurchases != null ? String(initial.totalPurchases) : '',
    totalReturns: initial.totalReturns != null ? String(initial.totalReturns) : '',
    disputeCount: initial.disputeCount != null ? String(initial.disputeCount) : '',
    notes: initial.notes ?? '',
  } : { ...BLANK });
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof PerfForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let cancelled = false;
    if (!form.companyId) { setSuppliers([]); return; }
    fetch(`/api/backend/suppliers?companyId=${encodeURIComponent(form.companyId)}&limit=500`)
      .then((r) => r.json())
      .then((j) => {
        const rows = Array.isArray(j?.data?.data) ? j.data.data : Array.isArray(j?.data) ? j.data : [];
        if (!cancelled) setSuppliers(rows);
      })
      .catch(() => { if (!cancelled) setSuppliers([]); });
    return () => { cancelled = true; };
  }, [form.companyId]);

  const submit = async () => {
    if (!form.companyId || !form.supplierId) { setError('Company and supplier are required'); return; }
    setSaving(true); setError('');
    try {
      const num = (v: string) => (v === '' ? undefined : Number(v));
      const body = {
        companyId: form.companyId,
        supplierId: form.supplierId,
        rating: form.rating || undefined,
        onTimeDeliveryRate: num(form.onTimeDeliveryRate),
        qualityScore: num(form.qualityScore),
        priceCompetitivenessScore: num(form.priceCompetitivenessScore),
        totalPurchases: num(form.totalPurchases),
        totalReturns: num(form.totalReturns),
        disputeCount: num(form.disputeCount),
        notes: form.notes || undefined,
      };
      if (mode === 'create') await backendPost('/supplier-performance', body);
      else await backendPut(`/supplier-performance/${initial!.id}`, body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Performance Record' : 'Edit Performance Record'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect label="Company" required disabled={mode === 'edit'} value={form.companyId}
          onChange={(e) => { set('companyId', e.target.value); set('supplierId', ''); }} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Supplier" required disabled={mode === 'edit' || !form.companyId} value={form.supplierId}
          onChange={(e) => set('supplierId', e.target.value)} placeholder={form.companyId ? 'Select…' : 'Select a company first'}>
          {mode === 'edit' && initial && !suppliers.some((s) => s.id === initial.supplierId) && (
            <option value={initial.supplierId}>{initial.supplierId}</option>
          )}
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </FormSelect>
        <FormSelect label="Rating" value={form.rating} onChange={(e) => set('rating', e.target.value)}>
          {RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
        </FormSelect>
        <FormInput label="On-Time Delivery %" type="number" min={0} max={100} step="0.01" value={form.onTimeDeliveryRate} onChange={(e) => set('onTimeDeliveryRate', e.target.value)} />
        <FormInput label="Quality Score" type="number" min={0} max={100} step="0.01" value={form.qualityScore} onChange={(e) => set('qualityScore', e.target.value)} />
        <FormInput label="Price Score" type="number" min={0} max={100} step="0.01" value={form.priceCompetitivenessScore} onChange={(e) => set('priceCompetitivenessScore', e.target.value)} />
        <FormInput label="Total Purchases" type="number" min={0} value={form.totalPurchases} onChange={(e) => set('totalPurchases', e.target.value)} />
        <FormInput label="Total Returns" type="number" min={0} value={form.totalReturns} onChange={(e) => set('totalReturns', e.target.value)} />
        <FormInput label="Dispute Count" type="number" min={0} value={form.disputeCount} onChange={(e) => set('disputeCount', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function SupplierPerformancePage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('supplier_performance.create');
  const canUpdate = hasPermission('supplier_performance.update');

  const [data, setData] = useState<SupplierPerf[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SupplierPerf | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetch('/api/backend/supplier-performance')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch((err) => {
        setData([]);
        setError(err instanceof Error ? err.message : 'Failed to load supplier performance records');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(j.data?.data ?? j.data ?? []))
      // Company options only enrich the modal dropdown and table names (raw ids remain as fallback).
      .catch(() => undefined);
  }, []);

  const onSaved = () => { setCreating(false); setEditing(null); load(); };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Supplier Performance</h1>
        <p className="text-gray-500 mt-1">Evaluate and track supplier performance metrics</p>
      </div>

      <div className="mb-6">
        <PageToolbar actions={canCreate ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Record</Btn> : null} />
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Overall Rating</th>
                <th className="px-4 py-3">On-Time Delivery %</th>
                <th className="px-4 py-3">Quality Score</th>
                <th className="px-4 py-3">Price Score</th>
                <th className="px-4 py-3">Total Purchases</th>
                {canUpdate && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={canUpdate ? 8 : 7} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">{row.company?.name ?? row.companyId}</td>
                  <td className="px-4 py-3 font-medium">{row.supplierId}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${RATING_CLS[row.rating] ?? 'bg-gray-100 text-gray-600'}`}>
                      {row.rating}
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.onTimeDeliveryRate != null ? `${row.onTimeDeliveryRate}%` : '—'}</td>
                  <td className="px-4 py-3">{row.qualityScore ?? '—'}</td>
                  <td className="px-4 py-3">{row.priceCompetitivenessScore ?? '—'}</td>
                  <td className="px-4 py-3 font-medium">{row.totalPurchases}</td>
                  {canUpdate && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Btn variant="ghost" size="xs" onClick={() => setEditing(row)}>Edit</Btn>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <PerfModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <PerfModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}
