'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  ProductPicker,
  showToast,
} from '@/components/ui';
import type { ProductPickerOption } from '@/components/ui';
import { ApiError, backendPost } from '@/lib/api-client';
import { useInventoryWorkspace } from '@/features/inventory/inventory-workspace-context';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockDamage {
  id: string;
  damageNumber: string;
  productName?: string;
  locationName?: string;
  quantity: number;
  damageType: string;
  estimatedValue: number;
  status: string;
  reportedBy?: string;
  notes?: string;
}

interface Company {
  id: string;
  name: string;
}
interface Branch {
  id: string;
  name: string;
}
interface Unit {
  id: string;
  name: string;
  symbol?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

// Values must match the backend StockDamageType enum.
const DAMAGE_TYPES = [
  { value: 'BREAKAGE', label: 'Breakage' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'SPOILED', label: 'Spoiled' },
  { value: 'LOST', label: 'Lost' },
  { value: 'THEFT', label: 'Theft' },
  { value: 'DAMAGED_PACKAGING', label: 'Damaged Packaging' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_CLR: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  SUBMITTED: 'bg-amber-50 text-amber-700 border-amber-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  POSTED: 'bg-blue-50 text-blue-700 border-blue-200',
  CANCELLED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span
      className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function fmtCurrency(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`;
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

function listFromJson<T>(j: unknown): T[] {
  const json = j as { data?: { data?: T[] } | T[] };
  const inner = json?.data;
  if (Array.isArray(inner)) return inner;
  if (inner && Array.isArray((inner as { data?: T[] }).data)) return (inner as { data: T[] }).data;
  return [];
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  onClose: () => void;
  onSaved: () => void;
}

function DamageModal({ onClose, onSaved }: ModalProps) {
  const workspace = useInventoryWorkspace();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [damageType, setDamageType] = useState('BREAKAGE');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [notes, setNotes] = useState('');
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
    if (!companyId) {
      setBranches([]);
      setBranchId('');
      return;
    }
    fetch(`/api/backend/branches?companyId=${encodeURIComponent(companyId)}&limit=200`)
      .then((r) => r.json())
      .then((j) => setBranches(listFromJson<Branch>(j)))
      .catch(() => setBranches([]));
  }, [companyId]);

  const onPickProduct = (id: string, product?: ProductPickerOption) => {
    setProductId(id);
    if (product?.defaultUnitId) setUnitId(product.defaultUnitId);
  };

  const submit = async () => {
    if (!companyId) {
      setError('Company is required');
      return;
    }
    if (!branchId) {
      setError('Branch is required');
      return;
    }
    if (!productId) {
      setError('Product is required');
      return;
    }
    if (!unitId) {
      setError('Unit is required');
      return;
    }
    if (quantity === '' || Number(quantity) <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await backendPost('/westsides/stock-damage', {
        companyId,
        branchId,
        productId,
        quantity: Number(quantity),
        unitId,
        damageType,
        ...(estimatedValue !== '' ? { estimatedValue: Number(estimatedValue) } : {}),
        ...(notes ? { notes } : {}),
      });
      showToast('success', 'Damage reported');
      onSaved();
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Error saving',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Report Stock Damage"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={submit} loading={saving}>
            Report Damage
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <FormSelect
          label="Company"
          required
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value);
            setProductId('');
          }}
          placeholder="Select…"
          disabled={Boolean(workspace)}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Branch"
          required
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          placeholder={companyId ? 'Select…' : 'Select company first'}
          disabled={!companyId || Boolean(workspace)}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </FormSelect>
        <div className="col-span-2">
          <label
            className="block text-[12px] font-medium mb-1"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            Product <span style={{ color: 'var(--aurora-danger)' }}>*</span>
          </label>
          <ProductPicker
            value={productId}
            onChange={onPickProduct}
            companyId={companyId || undefined}
            placeholder={companyId ? 'Search products…' : 'Select company first'}
            disabled={!companyId}
          />
        </div>
        <FormInput
          label="Quantity"
          required
          type="number"
          min={0}
          step="0.01"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0"
        />
        <FormSelect
          label="Unit"
          required
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          placeholder="Select…"
        >
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.symbol ? `${u.name} (${u.symbol})` : u.name}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Damage Type"
          value={damageType}
          onChange={(e) => setDamageType(e.target.value)}
          options={DAMAGE_TYPES}
        />
        <FormInput
          label="Estimated Value (TZS)"
          type="number"
          min={0}
          value={estimatedValue}
          onChange={(e) => setEstimatedValue(e.target.value)}
          placeholder="0"
        />
        <div className="col-span-2">
          <FormTextarea
            label="Notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Describe the damage…"
          />
        </div>
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type DamageAction = 'submit' | 'approve' | 'reject' | 'post';

const ACTION_DONE: Record<DamageAction, string> = {
  submit: 'Record submitted',
  approve: 'Record approved',
  reject: 'Record rejected',
  post: 'Record posted',
};

const STATUS_ACTIONS: Record<string, { action: DamageAction; label: string; cls: string }[]> = {
  DRAFT: [{ action: 'submit', label: 'Submit', cls: 'text-amber-600 hover:text-amber-800' }],
  SUBMITTED: [
    { action: 'approve', label: 'Approve', cls: 'text-emerald-600 hover:text-emerald-800' },
    { action: 'reject', label: 'Reject', cls: 'text-red-500 hover:text-red-700' },
  ],
  APPROVED: [{ action: 'post', label: 'Post', cls: 'text-blue-600 hover:text-blue-800' }],
};

export default function StockDamagePage() {
  const workspace = useInventoryWorkspace();
  const [items, setItems] = useState<StockDamage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);

  // Read the scope out of the workspace ONCE, into plain locals. An optional
  // chain in a dependency array is not something the React Compiler can track,
  // so `[workspace?.scope.companyId]` makes it skip the memoization it would
  // otherwise preserve — that is the lint error, not a style preference.
  const scopeCompanyId = workspace?.scope.companyId;
  const scopeBranchId = workspace?.scope.branchId;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (scopeCompanyId) params.set('companyId', scopeCompanyId);
      if (scopeBranchId) params.set('branchId', scopeBranchId);
      const res = await fetch(`/api/backend/westsides/stock-damage?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load stock damage records');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally {
      setLoading(false);
    }
  }, [scopeBranchId, scopeCompanyId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async (id: string, action: DamageAction) => {
    setActioning(`${id}-${action}`);
    try {
      const res = await fetch(`/api/backend/westsides/stock-damage/${id}/${action}`, {
        method: 'PATCH',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Action failed');
      }
      showToast('success', ACTION_DONE[action]);
      load();
    } catch (err: unknown) {
      showToast('error', 'Action failed', err instanceof Error ? err.message : undefined);
    } finally {
      setActioning(null);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Stock Damage & Breakage"
          subtitle="Report and manage stock damage, breakage, and expiry"
        />
        <button
          onClick={() => setModalOpen(true)}
          disabled={Boolean(workspace && (!workspace.scope.companyId || !workspace.scope.branchId))}
          title={
            workspace && (!workspace.scope.companyId || !workspace.scope.branchId)
              ? 'Select a company and branch above before reporting damage'
              : undefined
          }
          className="text-sm bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Report Damage
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading ? (
        <Spinner />
      ) : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No damage records found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Damage #</th>
                    <th className={thCls}>Product</th>
                    <th className={thCls}>Location</th>
                    <th className={`${thCls} text-right`}>Qty</th>
                    <th className={thCls}>Type</th>
                    <th className={`${thCls} text-right`}>Est. Value</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Reported By</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((d) => {
                    const actions = STATUS_ACTIONS[d.status] ?? [];
                    return (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`}>{d.damageNumber}</td>
                        <td className={tdCls}>{d.productName ?? '—'}</td>
                        <td className={tdCls}>{d.locationName ?? '—'}</td>
                        <td className={`${tdCls} text-right`}>{fmtNum(d.quantity)}</td>
                        <td className={tdCls}>{d.damageType?.replace(/_/g, ' ')}</td>
                        <td className={`${tdCls} text-right`}>{fmtCurrency(d.estimatedValue)}</td>
                        <td className={tdCls}>
                          <Badge status={d.status} />
                        </td>
                        <td className={tdCls}>{d.reportedBy ?? '—'}</td>
                        <td className="px-4 py-2 flex items-center gap-2">
                          {actions.map((a) => (
                            <button
                              key={a.action}
                              onClick={() => handleAction(d.id, a.action)}
                              disabled={actioning === `${d.id}-${a.action}`}
                              className={`text-xs font-medium disabled:opacity-50 ${a.cls}`}
                            >
                              {actioning === `${d.id}-${a.action}` ? '…' : a.label}
                            </button>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {modalOpen && (
        <DamageModal
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
