'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

const MAINTENANCE_TYPES = ['REPAIR','CLEANING','ELECTRICAL','PLUMBING','PAINTING','SECURITY','STRUCTURAL','OTHER'];
const MAINTENANCE_STATUSES = ['REPORTED','SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED'];
const CURRENCIES = ['TZS','USD','EUR','KES','UGX'];

interface Company { id: string; name: string; code: string; }
interface RentalProperty { id: string; propertyName: string; }
interface RentalUnit { id: string; unitNumber: string; }
interface PropertyMaintenance {
  id: string; maintenanceNumber: string; companyId: string; propertyId: string;
  rentalUnitId?: string; maintenanceDate: string; maintenanceType: string;
  description: string; currency: string; status: string;
  costAmount?: number; notes?: string;
  property?: { propertyName: string }; rentalUnit?: { unitNumber: string };
}

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtDate(d?: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function PropertyMaintenancePage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<PropertyMaintenance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PropertyMaintenance | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ maintenanceNumber: '', propertyId: '', rentalUnitId: '', maintenanceDate: '', maintenanceType: 'REPAIR', description: '', currency: 'TZS', status: 'REPORTED', costAmount: '', notes: '' });
  const [modalCompanyId, setModalCompanyId] = useState('');
  const [properties, setProperties] = useState<RentalProperty[]>([]);
  const [units, setUnits] = useState<RentalUnit[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PropertyMaintenance | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!modalCompanyId) return;
    fetch(`/api/backend/rental-properties?companyId=${modalCompanyId}&limit=100`).then(r => r.json()).then(j =>
      setProperties(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [modalCompanyId]);

  useEffect(() => {
    if (!form.propertyId) { setUnits([]); return; }
    fetch(`/api/backend/rental-units?propertyId=${form.propertyId}&limit=100`).then(r => r.json()).then(j =>
      setUnits(Array.isArray(j.data?.data) ? j.data.data : []));
  }, [form.propertyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/property-maintenance?companyId=${companyId}&page=1&limit=100`);
      if (!res.ok) throw new Error('Failed to load');
      const j = await res.json();
      const list = j.data?.data ?? j.data ?? [];
      setRows(Array.isArray(list) ? list : []);
      setTotal(j.data?.total ?? list.length);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null); setModalCompanyId(companyId);
    setForm({ maintenanceNumber: '', propertyId: '', rentalUnitId: '', maintenanceDate: '', maintenanceType: 'REPAIR', description: '', currency: 'TZS', status: 'REPORTED', costAmount: '', notes: '' });
    setShowModal(true);
  }
  function openEdit(row: PropertyMaintenance) {
    setEditing(row); setModalCompanyId(companyId);
    setForm({ maintenanceNumber: row.maintenanceNumber, propertyId: row.propertyId, rentalUnitId: row.rentalUnitId ?? '', maintenanceDate: row.maintenanceDate?.split('T')[0] ?? '', maintenanceType: row.maintenanceType, description: row.description, currency: row.currency, status: row.status, costAmount: row.costAmount != null ? String(row.costAmount) : '', notes: row.notes ?? '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.maintenanceNumber.trim()) { setError('Maintenance number required'); return; }
    if (!form.propertyId) { setError('Property required'); return; }
    if (!form.maintenanceDate) { setError('Date required'); return; }
    if (!form.description.trim()) { setError('Description required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, any> = { ...form, companyId: modalCompanyId, createdById: user?.id, costAmount: form.costAmount !== '' ? Number(form.costAmount) : undefined, rentalUnitId: form.rentalUnitId || undefined, notes: form.notes || undefined };
      const url = editing ? `/api/backend/property-maintenance/${editing.id}` : '/api/backend/property-maintenance';
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/backend/property-maintenance/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null); load();
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Property Maintenance" subtitle="Maintenance requests and repairs" />
        <div className="flex items-center gap-3">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openNew}>+ New Request</Btn>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load maintenance records.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{total} maintenance {total === 1 ? 'record' : 'records'}</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Number</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Property</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Unit</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Description</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Cost</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No maintenance records found.</td></tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{row.maintenanceNumber}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.property?.propertyName ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.rentalUnit?.unitNumber ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.maintenanceType}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{fmtDate(row.maintenanceDate)}</td>
                    <td className={`${tdCls} max-w-xs truncate`} style={{ color: 'var(--aurora-text)' }}>{row.description}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{row.costAmount != null ? fmtCurrency(row.costAmount) : '—'}</td>
                    <td className={tdCls}><StatusBadge status={row.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1">
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => setDeleteTarget(row)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Maintenance' : 'New Maintenance Request'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save Changes' : 'Create Request'}</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormSelect label="Company *" value={modalCompanyId} onChange={e => setModalCompanyId(e.target.value)}>
            <option value="">Select…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
          <FormInput label="Maintenance # *" value={form.maintenanceNumber} onChange={sf('maintenanceNumber')} placeholder="e.g. MNT-001" />
          <FormSelect label="Property *" value={form.propertyId} onChange={e => { setForm(f => ({ ...f, propertyId: e.target.value, rentalUnitId: '' })); }}>
            <option value="">Select property…</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.propertyName}</option>)}
          </FormSelect>
          <FormSelect label="Unit (optional)" value={form.rentalUnitId} onChange={sf('rentalUnitId')}>
            <option value="">— All units —</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.unitNumber}</option>)}
          </FormSelect>
          <FormSelect label="Maintenance Type *" value={form.maintenanceType} onChange={sf('maintenanceType')}>
            {MAINTENANCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
          <FormInput label="Date *" type="date" value={form.maintenanceDate} onChange={sf('maintenanceDate')} />
          <div className="col-span-2">
            <FormTextarea label="Description *" value={form.description} onChange={sf('description')} rows={3} placeholder="Describe the maintenance work required…" />
          </div>
          <FormInput label="Cost" type="number" min="0" step="0.01" value={form.costAmount} onChange={sf('costAmount')} placeholder="0.00" />
          <FormSelect label="Currency" value={form.currency} onChange={sf('currency')}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </FormSelect>
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {MAINTENANCE_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <div />
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Maintenance"
        message={`Delete "${deleteTarget?.maintenanceNumber}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
