'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, PageHeader, PageToolbar, StatCard, StatusBadge, Btn, PageSpinner,
  Modal, FormInput, FormSelect, FormTextarea,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }

interface FixedAsset {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  acquisitionCost: string;
  currentBookValue: string;
  status: string;
  ownershipLevel: string;
  collateralStatus: string;
  insuranceStatus: string;
  condition?: string | null;
  location?: string | null;
  serialNumber?: string | null;
  registrationNo?: string | null;
  make?: string | null;
  model?: string | null;
  acquisitionDate: string;
  company?: { id: string; name: string; code: string } | null;
}

interface AssetSummary {
  totalCount: number;
  activeCount: number;
  collateralCount: number;
  uninsuredCount: number;
  disposedCount: number;
  underMaintenanceCount: number;
  totalAcquisitionCost: number | string;
  totalBookValue: number | string;
  byCategory?: { category: string; count: number; bookValue: number | string }[];
  byCompany?: { company?: { id: string; name: string; code: string } | null; count: number; acquisitionCost: number | string; bookValue: number | string }[];
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const STATUSES = ['ACTIVE', 'UNDER_MAINTENANCE', 'DISPOSED', 'SOLD', 'LOST', 'WRITTEN_OFF', 'TRANSFERRED'];
const COLLATERAL_STATUSES = ['USED_AS_COLLATERAL', 'PARTIALLY_COLLATERAL', 'NOT_COLLATERAL'];
const INSURANCE_STATUSES = ['INSURED', 'NOT_INSURED', 'EXPIRED'];
const CATEGORIES = ['LAND', 'BUILDING', 'VEHICLE', 'TRUCK', 'PLANT_MACHINERY', 'MACHINERY', 'EQUIPMENT', 'FURNITURE_FITTINGS', 'COMPUTER_EQUIPMENT', 'IT_ASSET', 'OFFICE_EQUIPMENT', 'TOOLS', 'FUEL_TANK', 'FUEL_PUMP', 'AGRICULTURE_EQUIPMENT', 'CONSTRUCTION_EQUIPMENT', 'INTANGIBLE', 'OTHER'];
const OWNERSHIP_LEVELS = ['COMPANY', 'GROUP'];
const CONDITIONS = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'BEYOND_REPAIR'];
const FINANCING_STATUSES = ['OWNED_OUTRIGHT', 'FINANCED', 'LEASED', 'HIRE_PURCHASE'];
const CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX'];

function fmt(n: number | string) {
  const v = typeof n === 'string' ? Number(n) : n;
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(v || 0);
}

// ─── Fixed Asset Modal ────────────────────────────────────────────────────────

function FixedAssetModal({
  mode, initial, companies, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: FixedAsset;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    ownershipLevel: initial?.ownershipLevel ?? 'COMPANY',
    companyId: initial?.company?.id ?? '',
    assetCode: initial?.assetCode ?? '',
    name: initial?.name ?? '',
    category: initial?.category ?? 'EQUIPMENT',
    description: '',
    acquisitionDate: initial?.acquisitionDate?.slice(0, 10) ?? '',
    acquisitionCost: initial?.acquisitionCost ?? '',
    currency: 'TZS',
    currentBookValue: initial?.currentBookValue ?? '',
    depreciationRate: '',
    usefulLifeYears: '',
    residualValue: '',
    serialNumber: initial?.serialNumber ?? '',
    make: initial?.make ?? '',
    model: initial?.model ?? '',
    registrationNo: initial?.registrationNo ?? '',
    location: initial?.location ?? '',
    condition: initial?.condition ?? 'GOOD',
    financingStatus: 'OWNED_OUTRIGHT',
    collateralStatus: initial?.collateralStatus ?? 'NOT_COLLATERAL',
    insuranceStatus: initial?.insuranceStatus ?? 'NOT_INSURED',
    status: initial?.status ?? 'ACTIVE',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const setField = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.assetCode.trim() || !form.name.trim()) {
      setError('Asset code and name are required');
      return;
    }
    if (mode === 'create' && (!form.acquisitionDate || !form.acquisitionCost || !form.currentBookValue)) {
      setError('Acquisition date, cost, and current book value are required');
      return;
    }
    if (form.ownershipLevel === 'COMPANY' && !form.companyId) {
      setError('Pick a company when ownership level is COMPANY');
      return;
    }

    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        ownershipLevel: form.ownershipLevel,
        assetCode: form.assetCode.trim(),
        name: form.name.trim(),
        category: form.category,
        condition: form.condition,
        financingStatus: form.financingStatus,
        collateralStatus: form.collateralStatus,
        insuranceStatus: form.insuranceStatus,
        status: form.status,
        currency: form.currency,
      };
      if (form.companyId) body.companyId = form.companyId;
      if (form.description) body.description = form.description;
      if (form.acquisitionDate) body.acquisitionDate = form.acquisitionDate;
      if (form.acquisitionCost) body.acquisitionCost = form.acquisitionCost;
      if (form.currentBookValue) body.currentBookValue = form.currentBookValue;
      if (form.depreciationRate) body.depreciationRate = form.depreciationRate;
      if (form.usefulLifeYears) body.usefulLifeYears = Number(form.usefulLifeYears);
      if (form.residualValue) body.residualValue = form.residualValue;
      if (form.serialNumber) body.serialNumber = form.serialNumber;
      if (form.make) body.make = form.make;
      if (form.model) body.model = form.model;
      if (form.registrationNo) body.registrationNo = form.registrationNo;
      if (form.location) body.location = form.location;
      if (form.notes) body.notes = form.notes;

      const url = mode === 'create' ? '/api/backend/fixed-assets' : `/api/backend/fixed-assets/${initial!.id}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const message = (Array.isArray(j?.message) && j.message.join(', ')) || j?.message || `HTTP ${res.status}`;
        throw new Error(message);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'New Fixed Asset' : 'Edit Fixed Asset'}
      subtitle="Asset register entry — vehicles, plant, buildings, equipment"
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create' : 'Save'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-sm rounded-lg px-3 py-2 border" style={{ color: 'var(--aurora-danger)', borderColor: 'var(--aurora-danger)', background: 'var(--aurora-danger-bg, #fef2f2)' }}>
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Asset Code" required value={form.assetCode} onChange={(e) => setField('assetCode', e.target.value)} />
        <FormInput label="Name" required value={form.name} onChange={(e) => setField('name', e.target.value)} />

        <FormSelect label="Ownership Level" value={form.ownershipLevel} onChange={(e) => setField('ownershipLevel', e.target.value)}>
          {OWNERSHIP_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </FormSelect>
        <FormSelect label="Company" value={form.companyId} onChange={(e) => setField('companyId', e.target.value)} placeholder="— Group level —">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>

        <FormSelect label="Category" value={form.category} onChange={(e) => setField('category', e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </FormSelect>

        <FormInput label="Acquisition Date" required={mode === 'create'} type="date" value={form.acquisitionDate} onChange={(e) => setField('acquisitionDate', e.target.value)} />
        <FormSelect label="Currency" value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </FormSelect>

        <FormInput label="Acquisition Cost" required={mode === 'create'} type="number" step="0.01" value={form.acquisitionCost} onChange={(e) => setField('acquisitionCost', e.target.value)} />
        <FormInput label="Current Book Value" required={mode === 'create'} type="number" step="0.01" value={form.currentBookValue} onChange={(e) => setField('currentBookValue', e.target.value)} />

        <FormInput label="Depreciation Rate (%/year)" type="number" step="0.01" value={form.depreciationRate} onChange={(e) => setField('depreciationRate', e.target.value)} />
        <FormInput label="Useful Life (years)" type="number" value={form.usefulLifeYears} onChange={(e) => setField('usefulLifeYears', e.target.value)} />

        <FormInput label="Residual Value" type="number" step="0.01" value={form.residualValue} onChange={(e) => setField('residualValue', e.target.value)} />
        <FormInput label="Location" value={form.location} onChange={(e) => setField('location', e.target.value)} />

        <FormInput label="Make" value={form.make} onChange={(e) => setField('make', e.target.value)} />
        <FormInput label="Model" value={form.model} onChange={(e) => setField('model', e.target.value)} />

        <FormInput label="Serial Number" value={form.serialNumber} onChange={(e) => setField('serialNumber', e.target.value)} />
        <FormInput label="Registration #" value={form.registrationNo} onChange={(e) => setField('registrationNo', e.target.value)} />

        <FormSelect label="Condition" value={form.condition} onChange={(e) => setField('condition', e.target.value)}>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormSelect label="Financing" value={form.financingStatus} onChange={(e) => setField('financingStatus', e.target.value)}>
          {FINANCING_STATUSES.map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
        </FormSelect>

        <FormSelect label="Collateral Status" value={form.collateralStatus} onChange={(e) => setField('collateralStatus', e.target.value)}>
          {COLLATERAL_STATUSES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormSelect label="Insurance Status" value={form.insuranceStatus} onChange={(e) => setField('insuranceStatus', e.target.value)}>
          {INSURANCE_STATUSES.map((i) => <option key={i} value={i}>{i.replace(/_/g, ' ')}</option>)}
        </FormSelect>

        <div className="col-span-2"><FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => setField('description', e.target.value)} /></div>
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function FixedAssetDeleteConfirm({ asset, onClose, onConfirmed }: {
  asset: FixedAsset; onClose: () => void; onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/backend/fixed-assets/${asset.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? 'Delete failed');
      }
      onConfirmed();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Delete fixed asset?" size="sm"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" onClick={handleDelete} loading={saving}>Delete</Btn>
        </>
      }
    >
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Soft-delete <strong>{asset.assetCode} — {asset.name}</strong>? The record stays in the database for audit but is hidden from lists.
      </p>
    </Modal>
  );
}

export default function FixedAssetsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<FixedAsset> | null>(null);
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCollateral, setFilterCollateral] = useState('');
  const [filterInsurance, setFilterInsurance] = useState('');
  const [page, setPage] = useState(1);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FixedAsset | null>(null);
  const [deleting, setDeleting] = useState<FixedAsset | null>(null);

  const canView = hasPermission('fixed-assets.read');
  const canManage = hasPermission('fixed-assets.create');

  const reloadSummary = useCallback(() => {
    fetch('/api/backend/fixed-assets/summary').then((r) => r.json())
      .then((j) => setSummary(j.data ?? null));
  }, []);

  useEffect(() => {
    fetch('/api/backend/companies?limit=50').then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    reloadSummary();
  }, [reloadSummary]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search.trim()) params.set('search', search.trim());
      if (filterCompany) params.set('companyId', filterCompany);
      if (filterCategory) params.set('category', filterCategory);
      if (filterStatus) params.set('status', filterStatus);
      if (filterCollateral) params.set('collateralStatus', filterCollateral);
      if (filterInsurance) params.set('insuranceStatus', filterInsurance);
      const res = await fetch(`/api/backend/fixed-assets?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally { setLoading(false); }
  }, [page, search, filterCompany, filterCategory, filterStatus, filterCollateral, filterInsurance]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => {
    load();
    reloadSummary();
  }, [load, reloadSummary]);

  if (!canView) {
    return <div className="p-6"><PageHeader title="Fixed Assets" subtitle="Group-wide asset registry" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Fixed Assets"
        subtitle="Group-wide asset registry — collateral, insurance, and book value"
        actions={canManage && <Btn variant="primary" size="sm" onClick={() => setCreating(true)}>+ New Asset</Btn>}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total Assets" value={summary?.totalCount ?? 0} />
        <StatCard label="Active" value={summary?.activeCount ?? 0} hint="Operational" />
        <StatCard label="Book Value (TZS)" value={fmt(summary?.totalBookValue ?? 0)} />
        <StatCard label="Used as Collateral" value={summary?.collateralCount ?? 0} hint="Pledged assets" />
        <StatCard label="Uninsured" value={summary?.uninsuredCount ?? 0} hint="No insurance" />
        <StatCard label="Disposed/Sold" value={summary?.disposedCount ?? 0} hint="Exited assets" />
      </div>

      {summary?.byCompany?.length ? (
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>By Company</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {summary.byCompany.map((row, i) => (
              <div key={i} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
                <div className="text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>{row.company?.name ?? 'Unassigned'}</div>
                {row.company?.code && <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{row.company.code}</div>}
                <div className="mt-2 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>{row.count}</div>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Book value: TZS {fmt(row.bookValue)}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <PageToolbar
        search={search} onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Asset code, name, serial, registration…"
        filters={
          <>
            <select value={filterCompany} onChange={(e) => { setFilterCompany(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterCollateral} onChange={(e) => { setFilterCollateral(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Collateral</option>
              {COLLATERAL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterInsurance} onChange={(e) => { setFilterInsurance(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Insurance</option>
              {INSURANCE_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3 text-right">Book Value</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Collateral</th>
                <th className="px-4 py-3">Insurance</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={canManage ? 10 : 9}><PageSpinner /></td></tr>
                : !data?.data.length ? <tr><td colSpan={canManage ? 10 : 9} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No assets</td></tr>
                : data.data.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/group-control/fixed-assets/${a.id}`} className="text-brand-600 hover:underline">{a.assetCode}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <div>{a.name}</div>
                      {(a.make || a.model) && <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{[a.make, a.model].filter(Boolean).join(' ')}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">{a.category.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-xs">{a.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(a.acquisitionCost)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(a.currentBookValue)}</td>
                    <td className="px-4 py-3"><StatusBadge value={a.status} /></td>
                    <td className="px-4 py-3"><StatusBadge value={a.collateralStatus} /></td>
                    <td className="px-4 py-3"><StatusBadge value={a.insuranceStatus} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
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

      {creating && (
        <FixedAssetModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); refresh(); }}
        />
      )}
      {editing && (
        <FixedAssetModal
          mode="edit"
          initial={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {deleting && (
        <FixedAssetDeleteConfirm
          asset={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => { setDeleting(null); refresh(); }}
        />
      )}
    </div>
  );
}
