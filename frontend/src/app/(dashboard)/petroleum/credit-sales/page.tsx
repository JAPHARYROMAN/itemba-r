'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string; code: string }
interface Branch { id: string; name: string; branchCode: string }
interface Customer { id: string; name: string }
interface Product { id: string; name: string; productCode: string }
interface FuelShift { id: string; shiftNumber: string }

interface CreditSale {
  id: string;
  creditSaleNumber: string;
  saleDate: string;
  customer?: { name: string } | null;
  product?: { name: string } | null;
  litres: number;
  pricePerLitre: number;
  totalAmount: number;
  vehicleNumber?: string | null;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  OPEN: 'bg-amber-50 text-amber-700 border-amber-200',
  INVOICED: 'bg-blue-50 text-blue-700 border-blue-200',
  CANCELLED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status}</span>;
}

function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtNum(n: number) { return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

function CreateSaleModal({ companies, onClose, onSaved }: { companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');
  const [fuelShiftId, setFuelShiftId] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [litres, setLitres] = useState<number | ''>('');
  const [pricePerLitre, setPricePerLitre] = useState<number | ''>('');
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [shifts, setShifts] = useState<FuelShift[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const totalAmount = (Number(litres) || 0) * (Number(pricePerLitre) || 0);

  useEffect(() => {
    if (companyId) {
      fetch(`/api/backend/branches?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
      fetch(`/api/backend/customers?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setCustomers(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
      fetch(`/api/backend/products?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setProducts(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    }
  }, [companyId]);

  useEffect(() => {
    if (branchId) fetch(`/api/backend/petroleum/fuel-shifts?branchId=${branchId}&status=OPEN&limit=50`).then(r => r.json()).then(j => setShifts(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, [branchId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !branchId || !customerId || !productId || !litres || !pricePerLitre) { setError('Required fields missing'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        companyId, branchId, customerId, productId,
        fuelShiftId: fuelShiftId || undefined,
        vehicleNumber: vehicleNumber.trim() || undefined,
        driverName: driverName.trim() || undefined,
        litres: Number(litres), pricePerLitre: Number(pricePerLitre),
        totalAmount, saleDate,
      };
      const res = await fetch('/api/backend/petroleum/fuel-credit-sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[95vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">New Credit Sale</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Company *</label>
              <select required value={companyId} onChange={e => setCompanyId(e.target.value)} className={fieldCls}>
                <option value="">Select…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Branch *</label>
              <select required value={branchId} onChange={e => setBranchId(e.target.value)} className={fieldCls} disabled={!companyId}>
                <option value="">Select…</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.branchCode} – {b.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Customer *</label>
              <select required value={customerId} onChange={e => setCustomerId(e.target.value)} className={fieldCls} disabled={!companyId}>
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Product *</label>
              <select required value={productId} onChange={e => setProductId(e.target.value)} className={fieldCls} disabled={!companyId}>
                <option value="">Select product…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.productCode} – {p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Fuel Shift (optional)</label>
              <select value={fuelShiftId} onChange={e => setFuelShiftId(e.target.value)} className={fieldCls} disabled={!branchId}>
                <option value="">— No Shift —</option>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.shiftNumber}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Litres *</label>
              <input required type="number" step="0.01" value={litres} onChange={e => setLitres(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0.00" />
            </div>
            <div>
              <label className={labelCls}>Price per Litre *</label>
              <input required type="number" step="0.0001" value={pricePerLitre} onChange={e => setPricePerLitre(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0.0000" />
            </div>
            <div>
              <label className={labelCls}>Vehicle Number</label>
              <input value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} className={fieldCls} placeholder="T 123 ABC" />
            </div>
            <div>
              <label className={labelCls}>Driver Name</label>
              <input value={driverName} onChange={e => setDriverName(e.target.value)} className={fieldCls} placeholder="John Doe" />
            </div>
            <div>
              <label className={labelCls}>Sale Date *</label>
              <input required type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Total Amount</label>
              <div className="text-sm font-bold text-slate-900 px-3 py-2 bg-slate-50 border border-slate-200 rounded-md">{fmtNum(totalAmount)}</div>
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : 'Create Sale'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CreditSalesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sales, setSales] = useState<CreditSale[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/backend/petroleum/fuel-credit-sales?${params}`);
      if (!res.ok) throw new Error('Failed to load credit sales');
      const json = await res.json();
      setSales(json.data?.data ?? json.data ?? json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading sales');
    } finally { setLoading(false); }
  }, [companyId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id: string, action: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/backend/petroleum/fuel-credit-sales/${id}/${action}`, { method: 'PATCH' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Action failed'); }
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally { setActionLoading(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Credit Sales" subtitle="Manage petroleum credit sales" />
        <button onClick={() => setModalOpen(true)} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + New Credit Sale
        </button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Company</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} className={fieldCls}>
              <option value="">— Select Company —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={fieldCls}>
              <option value="">— All —</option>
              <option value="OPEN">Open</option>
              <option value="INVOICED">Invoiced</option>
              <option value="PAID">Paid</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <Spinner />}

      {!loading && companyId && (
        <Card className="overflow-hidden">
          {sales.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No credit sales found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Sale #</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Customer</th>
                    <th className={thCls}>Product</th>
                    <th className={`${thCls} text-right`}>Litres</th>
                    <th className={`${thCls} text-right`}>Price/L</th>
                    <th className={`${thCls} text-right`}>Total</th>
                    <th className={thCls}>Vehicle</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sales.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{s.creditSaleNumber}</td>
                      <td className={tdCls}>{fmtDate(s.saleDate)}</td>
                      <td className={tdCls}>{s.customer?.name ?? '—'}</td>
                      <td className={tdCls}>{s.product?.name ?? '—'}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmtNum(s.litres)}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmtNum(s.pricePerLitre)}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmtNum(s.totalAmount)}</td>
                      <td className={tdCls}>{s.vehicleNumber ?? '—'}</td>
                      <td className={tdCls}><Badge status={s.status} /></td>
                      <td className="px-4 py-2 text-right space-x-2">
                        {s.status === 'OPEN' && (
                          <>
                            <button onClick={() => doAction(s.id, 'invoice')} disabled={actionLoading === s.id} className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50">Invoice</button>
                            <button onClick={() => doAction(s.id, 'cancel')} disabled={actionLoading === s.id} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">Cancel</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!companyId && !loading && <div className="text-center py-10 text-sm text-slate-400">Select a company to view credit sales.</div>}

      {modalOpen && (
        <CreateSaleModal
          companies={companies}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
