'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Card, FormInput, FormSelect, Modal, PageHeader, showToast } from '@/components/ui';
import { ApiError, backendPost } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PackageMovement {
  id: string;
  movementNumber: string;
  movementDate: string;
  returnablePackageId?: string;
  customerId?: string | null;
  supplierId?: string | null;
  packageName?: string;
  partyName?: string;
  movementType: string;
  quantity: number;
  depositAmount: number;
  referenceType?: string | null;
  referenceId?: string | null;
}

interface Company { id: string; name: string }
interface Customer { id: string; name: string }
interface Supplier { id: string; name: string }
interface ReturnablePackageOption { id: string; packageCode?: string; name: string; companyId?: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

// Values must match the backend PackageMovementType enum.
const MOVEMENT_TYPES = [
  { value: 'ISSUED_TO_CUSTOMER', label: 'Issued to Customer' },
  { value: 'RETURNED_BY_CUSTOMER', label: 'Returned by Customer' },
  { value: 'RECEIVED_FROM_SUPPLIER', label: 'Received from Supplier' },
  { value: 'RETURNED_TO_SUPPLIER', label: 'Returned to Supplier' },
  { value: 'ADJUSTMENT_IN', label: 'Adjustment In' },
  { value: 'ADJUSTMENT_OUT', label: 'Adjustment Out' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'LOST', label: 'Lost' },
  { value: 'OTHER', label: 'Other' },
];

// Movement types the backend accepts on a customer-linked movement.
const CUSTOMER_MOVEMENT_TYPES = new Set([
  'ISSUED_TO_CUSTOMER',
  'RETURNED_BY_CUSTOMER',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
]);

const MOVEMENT_CLR: Record<string, string> = {
  ISSUED_TO_CUSTOMER: 'bg-amber-50 text-amber-700 border-amber-200',
  RETURNED_BY_CUSTOMER: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RECEIVED_FROM_SUPPLIER: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RETURNED_TO_SUPPLIER: 'bg-amber-50 text-amber-700 border-amber-200',
  ADJUSTMENT_IN: 'bg-blue-50 text-blue-700 border-blue-200',
  ADJUSTMENT_OUT: 'bg-blue-50 text-blue-700 border-blue-200',
  DAMAGED: 'bg-red-50 text-red-700 border-red-200',
  LOST: 'bg-red-50 text-red-700 border-red-200',
};

function Badge({ type }: { type: string }) {
  const cls = MOVEMENT_CLR[type] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtNum(n: number) { return new Intl.NumberFormat('en-US').format(n); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

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

function packageLabel(p: ReturnablePackageOption) {
  return p.packageCode ? `${p.packageCode} — ${p.name}` : p.name;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps { packages: ReturnablePackageOption[]; onClose: () => void; onSaved: () => void }

function MovementModal({ packages, onClose, onSaved }: ModalProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [returnablePackageId, setReturnablePackageId] = useState('');
  const [partyType, setPartyType] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [movementType, setMovementType] = useState('ISSUED_TO_CUSTOMER');
  const [quantity, setQuantity] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [referenceType, setReferenceType] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [movementDate, setMovementDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(listFromJson<Company>(j)))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (!companyId) { setCustomers([]); setCustomerId(''); setSuppliers([]); setSupplierId(''); return; }
    fetch(`/api/backend/customers?companyId=${encodeURIComponent(companyId)}&limit=500`)
      .then((r) => r.json())
      .then((j) => setCustomers(listFromJson<Customer>(j)))
      .catch(() => setCustomers([]));
    fetch(`/api/backend/suppliers?companyId=${encodeURIComponent(companyId)}&limit=500`)
      .then((r) => r.json())
      .then((j) => setSuppliers(listFromJson<Supplier>(j)))
      .catch(() => setSuppliers([]));
  }, [companyId]);

  // Only offer packages belonging to the chosen company (when the row carries one).
  const companyPackages = useMemo(
    () => packages.filter((p) => !companyId || !p.companyId || p.companyId === companyId),
    [packages, companyId],
  );

  // A customer-linked movement only supports the customer movement types.
  const movementTypeOptions = useMemo(
    () => (partyType === 'CUSTOMER' ? MOVEMENT_TYPES.filter((t) => CUSTOMER_MOVEMENT_TYPES.has(t.value)) : MOVEMENT_TYPES),
    [partyType],
  );

  useEffect(() => {
    if (partyType === 'CUSTOMER' && !CUSTOMER_MOVEMENT_TYPES.has(movementType)) {
      setMovementType('ISSUED_TO_CUSTOMER');
    }
  }, [partyType, movementType]);

  const submit = async () => {
    if (!companyId) { setError('Company is required'); return; }
    if (!returnablePackageId) { setError('Package is required'); return; }
    if (partyType === 'CUSTOMER' && !customerId) { setError('Select a customer'); return; }
    if (partyType === 'SUPPLIER' && !supplierId) { setError('Select a supplier'); return; }
    if (quantity === '' || Number(quantity) <= 0) { setError('Quantity must be greater than zero'); return; }
    if (!movementDate) { setError('Movement date is required'); return; }
    setSaving(true); setError('');
    try {
      await backendPost('/westsides/package-movements', {
        companyId,
        returnablePackageId,
        ...(partyType === 'CUSTOMER' && customerId ? { customerId } : {}),
        ...(partyType === 'SUPPLIER' && supplierId ? { supplierId } : {}),
        movementType,
        quantity: Number(quantity),
        ...(depositAmount !== '' ? { depositAmount: Number(depositAmount) } : {}),
        ...(referenceType ? { referenceType } : {}),
        ...(referenceId ? { referenceId } : {}),
        movementDate,
      });
      showToast('success', 'Movement recorded');
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Record Package Movement"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Record Movement</Btn></>}>
      {error && <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <FormSelect label="Company" required value={companyId} onChange={(e) => { setCompanyId(e.target.value); setReturnablePackageId(''); }} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Package" required value={returnablePackageId} onChange={(e) => setReturnablePackageId(e.target.value)} placeholder={companyId ? 'Select…' : 'Select company first'} disabled={!companyId}>
          {companyPackages.map((p) => <option key={p.id} value={p.id}>{packageLabel(p)}</option>)}
        </FormSelect>
        <FormSelect label="Party" value={partyType} onChange={(e) => { setPartyType(e.target.value); setCustomerId(''); setSupplierId(''); }} placeholder="None">
          <option value="CUSTOMER">Customer</option>
          <option value="SUPPLIER">Supplier</option>
        </FormSelect>
        {partyType === 'CUSTOMER' ? (
          <FormSelect label="Customer" required value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder={companyId ? 'Select…' : 'Select company first'} disabled={!companyId}>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
        ) : partyType === 'SUPPLIER' ? (
          <FormSelect label="Supplier" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} placeholder={companyId ? 'Select…' : 'Select company first'} disabled={!companyId}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </FormSelect>
        ) : (
          <div />
        )}
        <FormSelect label="Movement Type" required value={movementType} onChange={(e) => setMovementType(e.target.value)} options={movementTypeOptions} />
        <FormInput label="Movement Date" required type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
        <FormInput label="Quantity" required type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
        <FormInput label="Deposit Amount (TZS)" type="number" min={0} value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0" />
        <FormInput label="Reference Type" value={referenceType} onChange={(e) => setReferenceType(e.target.value)} placeholder="e.g. Delivery Note, Sales Order" />
        <FormInput label="Reference #" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} placeholder="e.g. DN-2026-00012" />
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PackageMovementsPage() {
  const [items, setItems] = useState<PackageMovement[]>([]);
  const [packages, setPackages] = useState<ReturnablePackageOption[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [filterCustomerId, setFilterCustomerId] = useState('');
  const [filterMovementType, setFilterMovementType] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filterCustomerId) params.set('customerId', filterCustomerId);
      if (filterMovementType) params.set('movementType', filterMovementType);
      const res = await fetch(`/api/backend/westsides/package-movements?${params}`);
      if (!res.ok) throw new Error('Failed to load package movements');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, [filterCustomerId, filterMovementType]);

  useEffect(() => { load(); }, [load]);

  // Reference data for the filter select, the modal package picker, and for
  // resolving names in the table (movement rows only carry raw ids).
  useEffect(() => {
    fetch('/api/backend/westsides/returnable-packages?limit=100')
      .then((r) => r.json())
      .then((j) => setPackages(listFromJson<ReturnablePackageOption>(j)))
      .catch(() => setPackages([]));
    fetch('/api/backend/customers?limit=500')
      .then((r) => r.json())
      .then((j) => setCustomers(listFromJson<Customer>(j)))
      .catch(() => setCustomers([]));
    fetch('/api/backend/suppliers?limit=500')
      .then((r) => r.json())
      .then((j) => setSuppliers(listFromJson<Supplier>(j)))
      .catch(() => setSuppliers([]));
  }, []);

  const packageName = (m: PackageMovement) => {
    if (m.packageName) return m.packageName;
    const p = packages.find((x) => x.id === m.returnablePackageId);
    return p ? packageLabel(p) : '—';
  };

  const partyName = (m: PackageMovement) => {
    if (m.partyName) return m.partyName;
    if (m.customerId) return customers.find((c) => c.id === m.customerId)?.name ?? '—';
    if (m.supplierId) return suppliers.find((s) => s.id === m.supplierId)?.name ?? '—';
    return '—';
  };

  const referenceLabel = (m: PackageMovement) => {
    const parts = [m.referenceType, m.referenceId].filter(Boolean);
    return parts.length ? parts.join(' ') : '—';
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Package Movements" subtitle="Track crate and bottle issue and return movements" />
        <button onClick={() => setModalOpen(true)} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + Record Movement
        </button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Customer</label>
            <select value={filterCustomerId} onChange={(e) => setFilterCustomerId(e.target.value)} className={fieldCls}>
              <option value="">All Customers</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Movement Type</label>
            <select value={filterMovementType} onChange={(e) => setFilterMovementType(e.target.value)} className={fieldCls}>
              <option value="">All Types</option>
              {MOVEMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No movements found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Movement #</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Package</th>
                    <th className={thCls}>Customer/Supplier</th>
                    <th className={thCls}>Type</th>
                    <th className={`${thCls} text-right`}>Quantity</th>
                    <th className={`${thCls} text-right`}>Deposit Amount</th>
                    <th className={thCls}>Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{m.movementNumber}</td>
                      <td className={tdCls}>{fmtDate(m.movementDate)}</td>
                      <td className={tdCls}>{packageName(m)}</td>
                      <td className={tdCls}>{partyName(m)}</td>
                      <td className={tdCls}><Badge type={m.movementType} /></td>
                      <td className={`${tdCls} text-right`}>{fmtNum(m.quantity)}</td>
                      <td className={`${tdCls} text-right`}>{fmtCurrency(m.depositAmount)}</td>
                      <td className={tdCls}>{referenceLabel(m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {modalOpen && (
        <MovementModal
          packages={packages}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
