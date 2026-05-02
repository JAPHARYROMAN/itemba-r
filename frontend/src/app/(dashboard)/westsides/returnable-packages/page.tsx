'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReturnablePackage {
  id: string;
  packageCode: string;
  name: string;
  packageType: string;
  depositValue: number;
  status: string;
}

interface PackageBalance {
  id: string;
  customerName?: string;
  packageName?: string;
  packageType?: string;
  quantityOwedByCustomer: number;
  quantityOwedToCustomer: number;
  depositBalance: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  RETIRED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
function fmtNum(n: number) { return new Intl.NumberFormat('en-US').format(n); }

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function CloseIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps { item: ReturnablePackage | null; onClose: () => void; onSaved: () => void }

function PackageModal({ item, onClose, onSaved }: ModalProps) {
  const [packageCode, setPackageCode] = useState(item?.packageCode ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [packageType, setPackageType] = useState(item?.packageType ?? 'CRATE');
  const [depositValue, setDepositValue] = useState<number | ''>(item?.depositValue ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packageCode || !name) { setError('Package code and name are required'); return; }
    setSaving(true); setError('');
    try {
      const body = { packageCode, name, packageType, depositValue: Number(depositValue) || 0 };
      const url = item ? `/api/backend/westsides/returnable-packages/${item.id}` : '/api/backend/westsides/returnable-packages';
      const method = item ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{item ? 'Edit Package' : 'New Returnable Package'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Package Code *</label>
              <input required value={packageCode} onChange={(e) => setPackageCode(e.target.value)} className={fieldCls} placeholder="e.g. CRATE-20L" />
            </div>
            <div>
              <label className={labelCls}>Name *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} placeholder="e.g. 20L Crate" />
            </div>
            <div>
              <label className={labelCls}>Type</label>
              <select value={packageType} onChange={(e) => setPackageType(e.target.value)} className={fieldCls}>
                <option value="CRATE">Crate</option>
                <option value="BOTTLE">Bottle</option>
                <option value="KEG">Keg</option>
                <option value="DRUM">Drum</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Deposit Value (TZS)</label>
              <input type="number" min={0} value={depositValue} onChange={(e) => setDepositValue(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0" />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : item ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReturnablePackagesPage() {
  const [items, setItems] = useState<ReturnablePackage[]>([]);
  const [balances, setBalances] = useState<PackageBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [balLoading, setBalLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReturnablePackage | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/backend/westsides/returnable-packages?limit=100');
      if (!res.ok) throw new Error('Failed to load packages');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, []);

  const loadBalances = useCallback(async () => {
    setBalLoading(true);
    try {
      const res = await fetch('/api/backend/westsides/returnable-packages/balances?limit=100');
      const json = await res.json();
      setBalances(json.data?.data ?? json.data ?? []);
    } finally { setBalLoading(false); }
  }, []);

  useEffect(() => { load(); loadBalances(); }, [load, loadBalances]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Returnable Packages" subtitle="Manage returnable packaging — crates, bottles, kegs" />
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + New Package
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No packages found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Package Code</th>
                    <th className={thCls}>Name</th>
                    <th className={thCls}>Type</th>
                    <th className={`${thCls} text-right`}>Deposit Value</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((pkg) => (
                    <tr key={pkg.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{pkg.packageCode}</td>
                      <td className={tdCls}>{pkg.name}</td>
                      <td className={tdCls}>{pkg.packageType}</td>
                      <td className={`${tdCls} text-right`}>{fmtCurrency(pkg.depositValue)}</td>
                      <td className={tdCls}><Badge status={pkg.status} /></td>
                      <td className="px-4 py-2">
                        <button onClick={() => { setEditing(pkg); setModalOpen(true); }} className="text-xs text-indigo-600 hover:text-indigo-800">Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Package Balance by Customer */}
      <div>
        <div className="text-sm font-semibold text-slate-700 mb-3">Package Balance by Customer</div>
        {balLoading ? <Spinner /> : (
          <Card className="overflow-hidden">
            {balances.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No balance records found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className={thCls}>Customer</th>
                      <th className={thCls}>Package</th>
                      <th className={thCls}>Type</th>
                      <th className={`${thCls} text-right`}>Owed by Customer</th>
                      <th className={`${thCls} text-right`}>Owed to Customer</th>
                      <th className={`${thCls} text-right`}>Deposit Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {balances.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`}>{b.customerName ?? '—'}</td>
                        <td className={tdCls}>{b.packageName ?? '—'}</td>
                        <td className={tdCls}>{b.packageType ?? '—'}</td>
                        <td className={`${tdCls} text-right`}>{fmtNum(b.quantityOwedByCustomer)}</td>
                        <td className={`${tdCls} text-right`}>{fmtNum(b.quantityOwedToCustomer)}</td>
                        <td className={`${tdCls} text-right font-semibold ${b.depositBalance > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{fmtCurrency(b.depositBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>

      {modalOpen && (
        <PackageModal
          item={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={() => { setModalOpen(false); setEditing(null); load(); loadBalances(); }}
        />
      )}
    </div>
  );
}
