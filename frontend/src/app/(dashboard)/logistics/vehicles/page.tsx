'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  PageHeader,
  Modal,
  Btn,
  PageToolbar,
  FormInput,
  FormSelect,
  FormTextarea,
  DateInput,
  PageSpinner,
  StatusBadge,
  ConfirmDialog,
} from '@/components/ui';
import { backendDelete } from '@/lib/api-client';

const VEHICLE_TYPES = [
  'TRUCK',
  'TRAILER',
  'PICKUP',
  'VAN',
  'MOTORCYCLE',
  'TRACTOR',
  'HEAVY_EQUIPMENT',
  'OTHER',
];
const FUEL_TYPES = ['DIESEL', 'PETROL', 'CNG', 'ELECTRIC', 'HYBRID'];
const VEHICLE_STATUSES = ['ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'SOLD', 'DISPOSED'];

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Division {
  id: string;
  name: string;
  code: string;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const EMPTY_FORM = {
  vehicleCode: '',
  registrationNumber: '',
  vehicleType: 'TRUCK',
  make: '',
  model: '',
  year: '',
  fuelType: 'DIESEL',
  currentOdometer: '',
  insuranceExpiryDate: '',
  roadLicenseExpiryDate: '',
  inspectionExpiryDate: '',
  status: 'ACTIVE',
  notes: '',
};

export default function VehiclesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<null | 'create' | Record<string, any>>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLabel, setDeleteLabel] = useState('');

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
    if (!companyId) {
      setDivisions([]);
      setDivisionId('');
      return;
    }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=50`)
      .then((r) => r.json())
      .then((j) => {
        const divs = Array.isArray(j.data?.data)
          ? j.data.data
          : Array.isArray(j.data)
            ? j.data
            : [];
        setDivisions(divs);
        if (divs.length > 0) setDivisionId(divs[0].id);
        else setDivisionId('');
      });
  }, [companyId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/backend/logistics/vehicles?companyId=${companyId}&page=1&limit=20`,
      );
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(
        Array.isArray(json.data?.data)
          ? json.data
          : { data: Array.isArray(json.data) ? json.data : [], total: 0 },
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setModal('create');
  }

  function openEdit(row: any) {
    setForm({
      vehicleCode: row.vehicleCode ?? '',
      registrationNumber: row.registrationNumber ?? '',
      vehicleType: row.vehicleType ?? 'TRUCK',
      make: row.make ?? '',
      model: row.model ?? '',
      year: row.year ?? '',
      fuelType: row.fuelType ?? 'DIESEL',
      currentOdometer: row.currentOdometer ?? '',
      insuranceExpiryDate: row.insuranceExpiryDate ? row.insuranceExpiryDate.slice(0, 10) : '',
      roadLicenseExpiryDate: row.roadLicenseExpiryDate
        ? row.roadLicenseExpiryDate.slice(0, 10)
        : '',
      inspectionExpiryDate: row.inspectionExpiryDate ? row.inspectionExpiryDate.slice(0, 10) : '',
      status: row.status ?? 'ACTIVE',
      notes: row.notes ?? '',
    });
    setModal(row);
  }

  async function handleSave() {
    if (!form.vehicleCode || !form.registrationNumber || !form.vehicleType) {
      alert('Vehicle Code, Plate Number, and Type are required.');
      return;
    }
    setSaving(true);
    try {
      const isEdit = modal !== null && typeof modal !== 'string';
      const url = isEdit
        ? `/api/backend/logistics/vehicles/${(modal as any).id}`
        : '/api/backend/logistics/vehicles';
      const method = isEdit ? 'PUT' : 'POST';
      const body = {
        ...form,
        companyId,
        divisionId,
        year: form.year !== '' ? Number(form.year) : undefined,
        currentOdometer: form.currentOdometer !== '' ? Number(form.currentOdometer) : undefined,
      };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.message ?? 'Save failed');
      }
      setModal(null);
      await load();
      setToast({ message: 'Vehicle saved successfully.', type: 'success' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setToast({ message: 'Failed to save Vehicle.', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await backendDelete(`/logistics/vehicles/${deleteId}`);
      setToast({ message: `${deleteLabel} deleted successfully.`, type: 'success' });
      await load();
    } catch {
      setToast({ message: `Failed to delete ${deleteLabel}.`, type: 'error' });
    } finally {
      setDeleteId(null);
    }
  }

  const isEdit = modal !== null && typeof modal !== 'string';

  return (
    <div className="p-6 space-y-4">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded shadow-lg text-sm font-medium text-white transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}
        >
          {toast.message}
        </div>
      )}

      <PageHeader title="Vehicles" subtitle="Logistics fleet management" />

      <PageToolbar
        filters={
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            style={{ color: 'var(--aurora-text)' }}
          >
            <option value="">— Select Company —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        }
        actions={companyId ? <Btn onClick={openCreate}>+ New Vehicle</Btn> : undefined}
      />

      {!companyId && (
        <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Select a company to load data.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div
            className="px-4 py-3 border-b border-slate-100 text-xs"
            style={{ color: 'var(--aurora-text-muted)' }}
          >
            {data.total} vehicles
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Code
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Plate Number
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Type
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Make / Model
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Fuel Type
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Odometer
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Insurance Expiry
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Status
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No vehicles found.
                    </td>
                  </tr>
                ) : (
                  data.data.map((v: any) => (
                    <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td
                        className={`${tdCls} font-medium`}
                        style={{ color: 'var(--aurora-text)' }}
                      >
                        {v.vehicleCode}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {v.registrationNumber}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {v.vehicleType?.replace(/_/g, ' ')}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {[v.make, v.model].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {v.fuelType ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {v.currentOdometer ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {v.insuranceExpiryDate ? fmtDate(v.insuranceExpiryDate) : '—'}
                      </td>
                      <td className={tdCls}>
                        <StatusBadge status={v.status} />
                      </td>
                      <td className={tdCls}>
                        <div className="flex gap-3">
                          <Btn variant="ghost" size="xs" onClick={() => openEdit(v)}>
                            Edit
                          </Btn>
                          <Btn
                            variant="danger"
                            size="xs"
                            onClick={() => {
                              setDeleteId(v.id);
                              setDeleteLabel(v.vehicleCode || v.registrationNumber);
                            }}
                          >
                            Delete
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={isEdit ? 'Edit Vehicle' : 'New Vehicle'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setModal(null)}>
              Cancel
            </Btn>
            <Btn loading={saving} onClick={handleSave}>
              Save
            </Btn>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput
            label="Vehicle Code"
            value={form.vehicleCode}
            onChange={(e) => setForm((f) => ({ ...f, vehicleCode: e.target.value }))}
            placeholder="e.g. VEH-001"
            required
          />
          <FormInput
            label="Plate Number"
            value={form.registrationNumber}
            onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))}
            placeholder="e.g. T 123 ABC"
            required
          />
          <FormSelect
            label="Vehicle Type"
            value={form.vehicleType}
            onChange={(e) => setForm((f) => ({ ...f, vehicleType: e.target.value }))}
            required
          >
            {VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Fuel Type"
            value={form.fuelType}
            onChange={(e) => setForm((f) => ({ ...f, fuelType: e.target.value }))}
          >
            {FUEL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </FormSelect>
          <FormInput
            label="Make"
            value={form.make}
            onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))}
            placeholder="e.g. Isuzu"
          />
          <FormInput
            label="Model"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            placeholder="e.g. FVZ"
          />
          <FormInput
            label="Year"
            type="number"
            value={form.year}
            onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
            placeholder="e.g. 2020"
            min="1900"
            max="2100"
          />
          <FormInput
            label="Odometer (km)"
            type="number"
            value={form.currentOdometer}
            onChange={(e) => setForm((f) => ({ ...f, currentOdometer: e.target.value }))}
            placeholder="km"
            min="0"
          />
          <DateInput
            label="Insurance Expiry"
            value={form.insuranceExpiryDate}
            onChange={(e) => setForm((f) => ({ ...f, insuranceExpiryDate: e.target.value }))}
          />
          <DateInput
            label="Road License Expiry"
            value={form.roadLicenseExpiryDate}
            onChange={(e) => setForm((f) => ({ ...f, roadLicenseExpiryDate: e.target.value }))}
          />
          <DateInput
            label="Inspection Expiry"
            value={form.inspectionExpiryDate}
            onChange={(e) => setForm((f) => ({ ...f, inspectionExpiryDate: e.target.value }))}
          />
          <FormSelect
            label="Status"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
          >
            {VEHICLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </FormSelect>
          {divisions.length > 1 && (
            <FormSelect
              label="Division"
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
            >
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </FormSelect>
          )}
          <FormTextarea
            className="sm:col-span-2"
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Optional notes…"
            rows={3}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Vehicle"
        message={`Are you sure you want to delete "${deleteLabel}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
