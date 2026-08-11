'use client';

import { useCallback, useEffect, useState } from 'react';
import { Btn, Card, ConfirmDialog, FormInput, FormSelect, Modal, PageHeader, showToast } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { ApiError, backendDelete, backendPatch, backendPost } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string }

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

const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const PACKAGE_TYPES = [
  { value: 'EMPTY_CRATE', label: 'Empty Crate' },
  { value: 'EMPTY_BOTTLE', label: 'Empty Bottle' },
  { value: 'KEG', label: 'Keg' },
  { value: 'PALLET', label: 'Pallet' },
  { value: 'CYLINDER', label: 'Cylinder' },
  { value: 'OTHER', label: 'Other' },
];

const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtNum(n: number) { return new Intl.NumberFormat('en-US').format(n); }

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface PackageForm { companyId: string; name: string; packageType: string; depositValue: string; status: string }

interface ModalProps {
  mode: 'create' | 'edit';
  initial?: ReturnablePackage;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}

function PackageModal({ mode, initial, companies, onClose, onSaved }: ModalProps) {
  const [form, setForm] = useState<PackageForm>(() => initial ? {
    companyId: '',
    name: initial.name,
    packageType: initial.packageType,
    depositValue: String(initial.depositValue ?? 0),
    status: initial.status,
  } : { companyId: '', name: '', packageType: 'EMPTY_CRATE', depositValue: '', status: 'ACTIVE' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof PackageForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (mode === 'create' && !form.companyId) { setError('Company is required'); return; }
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      if (mode === 'create') {
        await backendPost('/westsides/returnable-packages', {
          companyId: form.companyId,
          name: form.name.trim(),
          packageType: form.packageType,
          depositValue: Number(form.depositValue) || 0,
        });
      } else {
        await backendPatch(`/westsides/returnable-packages/${initial!.id}`, {
          name: form.name.trim(),
          packageType: form.packageType,
          depositValue: Number(form.depositValue) || 0,
          status: form.status,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Returnable Package' : 'Edit Package'}
      subtitle={mode === 'edit' ? initial!.packageCode : undefined}
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>{mode === 'create' ? 'Create' : 'Update'}</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        {mode === 'create' && (
          <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…" className="col-span-2">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
        )}
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. 20L Crate" />
        <FormSelect label="Type" value={form.packageType} onChange={(e) => set('packageType', e.target.value)} options={PACKAGE_TYPES} />
        <FormInput label="Deposit Value (TZS)" type="number" min={0} value={form.depositValue} onChange={(e) => set('depositValue', e.target.value)} placeholder="0" />
        {mode === 'edit' && (
          <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)} options={STATUSES} />
        )}
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReturnablePackagesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('returnable_packages.manage');

  const [items, setItems] = useState<ReturnablePackage[]>([]);
  const [balances, setBalances] = useState<PackageBalance[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [balLoading, setBalLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ReturnablePackage | null>(null);
  const [deleting, setDeleting] = useState<ReturnablePackage | null>(null);

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
    } catch {
      setBalances([]);
    } finally { setBalLoading(false); }
  }, []);

  useEffect(() => { load(); loadBalances(); }, [load, loadBalances]);

  useEffect(() => {
    if (!canManage) return;
    // Company options only feed the create/edit modal dropdown — the list itself still renders.
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? [])).catch(() => undefined);
  }, [canManage]);

  const onSaved = () => { setCreating(false); setEditing(null); load(); loadBalances(); };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await backendDelete(`/westsides/returnable-packages/${deleting.id}`);
      showToast('success', 'Package deleted', deleting.packageCode);
      setDeleting(null);
      load(); loadBalances();
    } catch (err) {
      setDeleting(null);
      showToast('error', 'Delete failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Returnable Packages" subtitle="Manage returnable packaging — crates, bottles, kegs" />
        {canManage && <Btn variant="primary" onClick={() => setCreating(true)}>+ New Package</Btn>}
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
                    {canManage && <th className={`${thCls} text-right`}></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((pkg) => (
                    <tr key={pkg.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{pkg.packageCode}</td>
                      <td className={tdCls}>{pkg.name}</td>
                      <td className={tdCls}>{pkg.packageType.replace(/_/g, ' ')}</td>
                      <td className={`${tdCls} text-right`}>{fmtCurrency(pkg.depositValue)}</td>
                      <td className={tdCls}><Badge status={pkg.status} /></td>
                      {canManage && (
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(pkg)}>Edit</Btn>
                          <Btn variant="ghost" size="xs" onClick={() => setDeleting(pkg)}>Delete</Btn>
                        </td>
                      )}
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
                        <td className={tdCls}>{b.packageType?.replace(/_/g, ' ') ?? '—'}</td>
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

      {creating && <PackageModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <PackageModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Package"
        message={deleting ? `Delete ${deleting.name} (${deleting.packageCode})? This cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
