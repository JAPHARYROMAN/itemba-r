'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Branch {
  id: string;
  name: string;
  branchCode: string;
}
interface Product {
  id: string;
  name: string;
  productCode: string;
}

interface FuelTank {
  id: string;
  tankCode: string;
  tankName: string;
  product?: { name: string } | null;
  branch?: { name: string } | null;
  capacityLitres: number;
  currentBookBalance: number;
  lastDipBalance: number;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls =
  'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span
      className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {status}
    </span>
  );
}

function fmtNum(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  tank: FuelTank | null;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}

function TankModal({ tank, companies, onClose, onSaved }: ModalProps) {
  const [companyId, setCompanyId] = useState(tank ? '' : '');
  const [branchId, setBranchId] = useState('');
  const [productId, setProductId] = useState('');
  const [tankCode, setTankCode] = useState(tank?.tankCode ?? '');
  const [tankName, setTankName] = useState(tank?.tankName ?? '');
  const [capacityLitres, setCapacityLitres] = useState<number | ''>(tank?.capacityLitres ?? '');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (companyId) {
      fetch(`/api/backend/branches?companyId=${companyId}&limit=200`)
        .then((r) => r.json())
        .then((j) =>
          setBranches(
            Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
          ),
        );
      fetch(`/api/backend/products?companyId=${companyId}&limit=200`)
        .then((r) => r.json())
        .then((j) =>
          setProducts(
            Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
          ),
        );
    }
  }, [companyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !branchId || !productId || !tankCode || !tankName) {
      setError('All required fields must be filled');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        tankCode,
        tankName,
        productId,
        branchId,
        companyId,
        capacityLitres: Number(capacityLitres) || 0,
      };
      const url = tank
        ? `/api/backend/petroleum/fuel-tanks/${tank.id}`
        : '/api/backend/petroleum/fuel-tanks';
      const method = tank ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Save failed');
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {tank ? 'Edit Fuel Tank' : 'New Fuel Tank'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <CloseIcon />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Company *</label>
              <select
                required
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className={fieldCls}
              >
                <option value="">Select…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Branch *</label>
              <select
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className={fieldCls}
                disabled={!companyId}
              >
                <option value="">Select…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branchCode} – {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Tank Code *</label>
              <input
                required
                value={tankCode}
                onChange={(e) => setTankCode(e.target.value)}
                className={fieldCls}
                placeholder="e.g. TK-001"
              />
            </div>
            <div>
              <label className={labelCls}>Tank Name *</label>
              <input
                required
                value={tankName}
                onChange={(e) => setTankName(e.target.value)}
                className={fieldCls}
                placeholder="e.g. Tank 1 – Petrol"
              />
            </div>
            <div>
              <label className={labelCls}>Product *</label>
              <select
                required
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className={fieldCls}
                disabled={!companyId}
              >
                <option value="">Select…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.productCode} – {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Capacity (Litres)</label>
              <input
                type="number"
                step="0.01"
                value={capacityLitres}
                onChange={(e) =>
                  setCapacityLitres(e.target.value === '' ? '' : Number(e.target.value))
                }
                className={fieldCls}
                placeholder="0"
              />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
            disabled={saving}
            className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium"
          >
            {saving ? 'Saving…' : tank ? 'Update Tank' : 'Create Tank'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FuelTanksPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [tanks, setTanks] = useState<FuelTank[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FuelTank | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      );
  }, []);

  useEffect(() => {
    if (companyId) {
      fetch(`/api/backend/branches?companyId=${companyId}&limit=200`)
        .then((r) => r.json())
        .then((j) =>
          setBranches(
            Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
          ),
        );
    } else {
      setBranches([]);
      setBranchId('');
    }
  }, [companyId]);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/petroleum/fuel-tanks/branch/${branchId}`);
      if (!res.ok) throw new Error('Failed to load tanks');
      const json = await res.json();
      Array.isArray(json.data?.data) ? json.data.data : Array.isArray(json.data) ? json.data : [];
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading tanks');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this tank?')) return;
    setDeleting(id);
    try {
      await fetch(`/api/backend/petroleum/fuel-tanks/${id}`, { method: 'DELETE' });
      load();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Fuel Tanks" subtitle="Manage petroleum storage tanks" />
        <button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium"
        >
          + New Tank
        </button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Company</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={fieldCls}
            >
              <option value="">— All Companies —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Branch</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className={fieldCls}
              disabled={!companyId}
            >
              <option value="">— Select Branch —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.branchCode} – {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && <Spinner />}

      {!loading && branchId && (
        <Card className="overflow-hidden">
          {tanks.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">
              No tanks found for this branch.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Code</th>
                    <th className={thCls}>Name</th>
                    <th className={thCls}>Product</th>
                    <th className={thCls}>Branch</th>
                    <th className={`${thCls} text-right`}>Capacity (L)</th>
                    <th className={`${thCls} text-right`}>Book Balance (L)</th>
                    <th className={`${thCls} text-right`}>Last Dip (L)</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tanks.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{t.tankCode}</td>
                      <td className={tdCls}>{t.tankName}</td>
                      <td className={tdCls}>{t.product?.name ?? '—'}</td>
                      <td className={tdCls}>{t.branch?.name ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{fmtNum(t.capacityLitres)}</td>
                      <td className={`${tdCls} text-right`}>{fmtNum(t.currentBookBalance)}</td>
                      <td className={`${tdCls} text-right`}>{fmtNum(t.lastDipBalance)}</td>
                      <td className={tdCls}>
                        <Badge status={t.status} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => {
                            setEditing(t);
                            setModalOpen(true);
                          }}
                          className="text-xs text-indigo-600 hover:text-indigo-800 mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          disabled={deleting === t.id}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          {deleting === t.id ? '…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!branchId && !loading && (
        <div className="text-center py-10 text-sm text-slate-400">
          Select a company and branch to view tanks.
        </div>
      )}

      {modalOpen && (
        <TankModal
          tank={editing}
          companies={companies}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setModalOpen(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
