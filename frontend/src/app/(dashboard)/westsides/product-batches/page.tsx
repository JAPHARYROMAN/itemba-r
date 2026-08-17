'use client';

import { useCallback, useEffect, useState } from 'react';
import { Btn, Card, FormInput, FormSelect, Modal, PageHeader, ProductPicker, showToast } from '@/components/ui';
import type { ProductPickerOption } from '@/components/ui';
import { ApiError, backendPost } from '@/lib/api-client';
import { useInventoryWorkspace } from '@/features/inventory/inventory-workspace-context';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductBatch {
  id: string;
  batchNumber: string;
  productName?: string;
  supplierName?: string;
  locationName?: string;
  manufactureDate?: string;
  expiryDate?: string;
  initialQuantity?: number | string;
  remainingQuantity?: number | string;
  status: string;
}

interface Company { id: string; name: string }
interface Branch { id: string; name: string }
interface Supplier { id: string; name: string }
interface Unit { id: string; name: string; symbol?: string | null }

type TabKey = 'all' | 'expiring' | 'expired';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EXPIRING_SOON: 'bg-amber-50 text-amber-700 border-amber-200',
  EXPIRED: 'bg-red-50 text-red-700 border-red-200',
  DEPLETED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  QUARANTINE: 'bg-red-50 text-red-700 border-red-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function expiryBadge(expiryDate?: string) {
  if (!expiryDate) return null;
  const now = new Date();
  const exp = new Date(expiryDate);
  const daysLeft = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-2" title="Expired" />;
  if (daysLeft < 30) return <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-2" title="Expiring soon" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-2" title="Active" />;
}

function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtNum(n: number | string | null | undefined) { const value = Number(n ?? 0); return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0); }

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function listFromJson<T>(j: unknown): T[] {
  const json = j as { data?: { data?: T[] } | T[] };
  const inner = json?.data;
  if (Array.isArray(inner)) return inner;
  if (inner && Array.isArray((inner as { data?: T[] }).data)) return (inner as { data: T[] }).data;
  return [];
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps { onClose: () => void; onSaved: () => void }

function BatchModal({ onClose, onSaved }: ModalProps) {
  const workspace = useInventoryWorkspace();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [manufactureDate, setManufactureDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [initialQuantity, setInitialQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!workspace) return;
    setCompanyId(workspace.scope.companyId);
    setBranchId(workspace.scope.branchId);
  }, [workspace?.scope.branchId, workspace?.scope.companyId]);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(listFromJson<Company>(j)))
      .catch(() => setCompanies([]));
    fetch('/api/backend/units?limit=500')
      .then((r) => r.json())
      .then((j) => setUnits(listFromJson<Unit>(j)))
      .catch(() => setUnits([]));
  }, []);

  useEffect(() => {
    if (!companyId) { setBranches([]); setBranchId(''); setSuppliers([]); setSupplierId(''); return; }
    fetch(`/api/backend/branches?companyId=${encodeURIComponent(companyId)}&limit=200`)
      .then((r) => r.json())
      .then((j) => setBranches(listFromJson<Branch>(j)))
      .catch(() => setBranches([]));
    fetch(`/api/backend/suppliers?companyId=${encodeURIComponent(companyId)}&limit=500`)
      .then((r) => r.json())
      .then((j) => setSuppliers(listFromJson<Supplier>(j)))
      .catch(() => setSuppliers([]));
  }, [companyId]);

  const onPickProduct = (id: string, product?: ProductPickerOption) => {
    setProductId(id);
    if (product?.defaultUnitId) setUnitId(product.defaultUnitId);
  };

  const submit = async () => {
    if (!companyId) { setError('Company is required'); return; }
    if (!productId) { setError('Product is required'); return; }
    if (!unitId) { setError('Unit is required'); return; }
    if (initialQuantity === '' || Number(initialQuantity) <= 0) { setError('Initial quantity must be greater than zero'); return; }
    setSaving(true); setError('');
    try {
      await backendPost('/westsides/product-batches', {
        companyId,
        productId,
        ...(branchId ? { branchId } : {}),
        ...(supplierId ? { supplierId } : {}),
        ...(manufactureDate ? { manufactureDate } : {}),
        ...(expiryDate ? { expiryDate } : {}),
        initialQuantity: Number(initialQuantity),
        unitId,
      });
      showToast('success', 'Batch created', 'The batch number is assigned automatically');
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="New Product Batch" subtitle="Batch number is generated automatically"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Create Batch</Btn></>}>
      {error && <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <FormSelect label="Company" required value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProductId(''); }} placeholder="Select…" className="col-span-2">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <div className="col-span-2">
          <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--aurora-text-secondary)' }}>
            Product <span style={{ color: 'var(--aurora-danger)' }}>*</span>
          </label>
          <ProductPicker value={productId} onChange={onPickProduct} companyId={companyId || undefined} placeholder={companyId ? 'Search products…' : 'Select company first'} disabled={!companyId} />
        </div>
        <FormSelect label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} placeholder={companyId ? 'None' : 'Select company first'} disabled={!companyId}>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </FormSelect>
        <FormSelect label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} placeholder={companyId ? 'None' : 'Select company first'} disabled={!companyId}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </FormSelect>
        <FormInput label="Manufacture Date" type="date" value={manufactureDate} onChange={(e) => setManufactureDate(e.target.value)} />
        <FormInput label="Expiry Date" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        <FormInput label="Initial Quantity" required type="number" min={0} step="0.01" value={initialQuantity} onChange={(e) => setInitialQuantity(e.target.value)} placeholder="0" />
        <FormSelect label="Unit" required value={unitId} onChange={(e) => setUnitId(e.target.value)} placeholder="Select…">
          {units.map((u) => <option key={u.id} value={u.id}>{u.symbol ? `${u.name} (${u.symbol})` : u.name}</option>)}
        </FormSelect>
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All Batches' },
  { key: 'expiring', label: 'Expiring Soon' },
  { key: 'expired', label: 'Expired' },
];

const TAB_ENDPOINT: Record<TabKey, string> = {
  all: '/api/backend/westsides/product-batches',
  expiring: '/api/backend/westsides/product-batches/expiring',
  expired: '/api/backend/westsides/product-batches/expired',
};

export default function ProductBatchesPage() {
  const workspace = useInventoryWorkspace();
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [items, setItems] = useState<ProductBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (workspace?.scope.companyId) params.set('companyId', workspace.scope.companyId);
      if (workspace?.scope.branchId) params.set('branchId', workspace.scope.branchId);
      const res = await fetch(`${TAB_ENDPOINT[activeTab]}?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load batches');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, [activeTab, workspace?.scope.branchId, workspace?.scope.companyId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Product Batches" subtitle="Batch and expiry tracking for beverages and perishables" />
        <button onClick={() => setModalOpen(true)} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + New Batch
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${activeTab === tab.key ? 'bg-white border border-b-white border-slate-200 text-indigo-700 -mb-px' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-400" /> Active</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> Expiring &lt;30 days</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" /> Expired</span>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No batches found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Batch #</th>
                    <th className={thCls}>Product</th>
                    <th className={thCls}>Supplier</th>
                    <th className={thCls}>Location</th>
                    <th className={thCls}>Mfg Date</th>
                    <th className={thCls}>Expiry Date</th>
                    <th className={`${thCls} text-right`}>Initial Qty</th>
                    <th className={`${thCls} text-right`}>Remaining</th>
                    <th className={thCls}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{b.batchNumber}</td>
                      <td className={tdCls}>{b.productName ?? '—'}</td>
                      <td className={tdCls}>{b.supplierName ?? '—'}</td>
                      <td className={tdCls}>{b.locationName ?? '—'}</td>
                      <td className={tdCls}>{b.manufactureDate ? fmtDate(b.manufactureDate) : '—'}</td>
                      <td className={tdCls}>
                        <span className="flex items-center">
                          {expiryBadge(b.expiryDate)}
                          {b.expiryDate ? fmtDate(b.expiryDate) : '—'}
                        </span>
                      </td>
                      <td className={`${tdCls} text-right`}>{fmtNum(b.initialQuantity)}</td>
                      <td className={`${tdCls} text-right`}>{fmtNum(b.remainingQuantity)}</td>
                      <td className={tdCls}><Badge status={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {modalOpen && (
        <BatchModal
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
