'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Branch {
  id: string;
  name: string;
  code?: string;
  branchCode?: string;
}

interface FuelTank {
  id: string;
  tankName: string;
  tankCode: string;
}

interface FuelPump {
  id: string;
  companyId: string;
  branchId: string;
  tankId: string | null;
  pumpCode: string;
  pumpName: string;
  tank?: { id: string; tankCode: string; tankName: string } | null;
  branch?: { id: string; code?: string; branchCode?: string; name: string } | null;
  status: string;
}

const fieldCls =
  'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  MAINTENANCE: 'bg-amber-50 text-amber-700 border-amber-200',
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

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function branchLabel(branch: Branch) {
  return `${branch.branchCode ?? branch.code ?? 'BR'} - ${branch.name}`;
}

function unwrapList<T>(json: unknown): T[] {
  const payload = json as { data?: { data?: unknown } | unknown };
  if (Array.isArray(payload.data && (payload.data as { data?: unknown }).data)) {
    return (payload.data as { data: T[] }).data;
  }
  if (Array.isArray(payload.data)) return payload.data as T[];
  if (Array.isArray(json)) return json as T[];
  return [];
}

function unwrapRecord<T>(json: unknown): T {
  const payload = json as { data?: unknown };
  return (payload.data ?? json) as T;
}

function PumpModal({
  pump,
  companies,
  onClose,
  onSaved,
}: {
  pump: FuelPump | null;
  companies: Company[];
  onClose: () => void;
  onSaved: (pump: FuelPump) => void;
}) {
  const [companyId, setCompanyId] = useState(pump?.companyId ?? '');
  const [branchId, setBranchId] = useState(pump?.branchId ?? '');
  const [tankId, setTankId] = useState(pump?.tankId ?? '');
  const [pumpCode, setPumpCode] = useState(pump?.pumpCode ?? '');
  const [pumpName, setPumpName] = useState(pump?.pumpName ?? '');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tanks, setTanks] = useState<FuelTank[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!companyId) {
      setBranches([]);
      setBranchId('');
      setTankId('');
      return;
    }

    fetch(`/api/backend/branches?companyId=${companyId}&limit=200`)
      .then((r) => r.json())
      .then((j) => setBranches(unwrapList<Branch>(j)))
      .catch(() => setBranches([]));
  }, [companyId]);

  useEffect(() => {
    if (!branchId) {
      setTanks([]);
      setTankId('');
      return;
    }

    fetch(`/api/backend/petroleum/fuel-tanks/branch/${branchId}`)
      .then((r) => r.json())
      .then((j) => setTanks(unwrapList<FuelTank>(j)))
      .catch(() => setTanks([]));
  }, [branchId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !branchId || !tankId || !pumpCode || !pumpName) {
      setError('All required fields must be filled');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const body = { pumpCode, pumpName, tankId, branchId, companyId };
      const url = pump
        ? `/api/backend/petroleum/fuel-pumps/${pump.id}`
        : '/api/backend/petroleum/fuel-pumps';
      const res = await fetch(url, {
        method: pump ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Save failed');
      }

      onSaved(unwrapRecord<FuelPump>(await res.json()));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {pump ? 'Edit Fuel Pump' : 'New Fuel Pump'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
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
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setBranchId('');
                  setTankId('');
                }}
                className={fieldCls}
              >
                <option value="">Select...</option>
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
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setTankId('');
                }}
                className={fieldCls}
                disabled={!companyId}
              >
                <option value="">Select...</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {branchLabel(b)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Pump Code *</label>
              <input
                required
                value={pumpCode}
                onChange={(e) => setPumpCode(e.target.value)}
                className={fieldCls}
                placeholder="PMP-001"
              />
            </div>

            <div>
              <label className={labelCls}>Pump Name *</label>
              <input
                required
                value={pumpName}
                onChange={(e) => setPumpName(e.target.value)}
                className={fieldCls}
                placeholder="Pump 1"
              />
            </div>

            <div className="col-span-2">
              <label className={labelCls}>Tank *</label>
              <select
                required
                value={tankId}
                onChange={(e) => setTankId(e.target.value)}
                className={fieldCls}
                disabled={!branchId}
              >
                <option value="">Select tank...</option>
                {tanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tankCode} - {t.tankName}
                  </option>
                ))}
              </select>
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
            {saving ? 'Saving...' : pump ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FuelPumpsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [pumps, setPumps] = useState<FuelPump[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FuelPump | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(unwrapList<Company>(j)))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (!companyId) {
      setBranches([]);
      setBranchId('');
      return;
    }

    fetch(`/api/backend/branches?companyId=${companyId}&limit=200`)
      .then((r) => r.json())
      .then((j) => setBranches(unwrapList<Branch>(j)))
      .catch(() => setBranches([]));
  }, [companyId]);

  const load = useCallback(async () => {
    const targetBranchId = branchId;
    if (!targetBranchId) {
      setPumps([]);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/petroleum/fuel-pumps/branch/${targetBranchId}`);
      if (!res.ok) throw new Error('Failed to load pumps');
      setPumps(unwrapList<FuelPump>(await res.json()));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading pumps');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this pump?')) return;
    await fetch(`/api/backend/petroleum/fuel-pumps/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Fuel Pumps" subtitle="Manage dispensing pumps at each branch" />
        <button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium"
        >
          + New Pump
        </button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Company</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={fieldCls}
            >
              <option value="">- Select Company -</option>
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
              <option value="">- Select Branch -</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {branchLabel(b)}
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
          {pumps.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">
              No pumps found for this branch.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Pump Code</th>
                    <th className={thCls}>Pump Name</th>
                    <th className={thCls}>Tank</th>
                    <th className={thCls}>Branch</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pumps.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{p.pumpCode}</td>
                      <td className={tdCls}>{p.pumpName}</td>
                      <td className={tdCls}>
                        {p.tank ? `${p.tank.tankCode} - ${p.tank.tankName}` : '-'}
                      </td>
                      <td className={tdCls}>{p.branch?.name ?? '-'}</td>
                      <td className={tdCls}>
                        <Badge status={p.status} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => {
                            setEditing(p);
                            setModalOpen(true);
                          }}
                          className="text-xs text-indigo-600 hover:text-indigo-800 mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Delete
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
          Select a company and branch to view pumps.
        </div>
      )}

      {modalOpen && (
        <PumpModal
          pump={editing}
          companies={companies}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSaved={(savedPump) => {
            setModalOpen(false);
            setEditing(null);
            setCompanyId(savedPump.companyId);
            setBranchId(savedPump.branchId);
            setPumps((current) => {
              const next = current.filter((pump) => pump.id !== savedPump.id);
              return [savedPump, ...next];
            });
          }}
        />
      )}
    </div>
  );
}
