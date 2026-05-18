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
  ConfirmDialog,
} from '@/components/ui';
import { backendDelete } from '@/lib/api-client';

const FUEL_SOURCES = ['PETROL_STATION', 'OWN_PUMP', 'VOUCHER', 'EMERGENCY'];

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
function fmtCurrency(n: number) {
  return `TZS ${new Intl.NumberFormat('en-US').format(n)}`;
}

const EMPTY_FORM = {
  tripId: '',
  vehicleId: '',
  fuelSource: 'PETROL_STATION',
  litres: '',
  unitPrice: '',
  totalCost: '',
  odometerBefore: '',
  odometerAfter: '',
  fuelDate: '',
  notes: '',
};

export default function TripFuelUsagePage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [trips, setTrips] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
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
      setTrips([]);
      setVehicles([]);
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
    fetch(`/api/backend/logistics/trips?companyId=${companyId}&limit=100`)
      .then((r) => r.json())
      .then((j) =>
        setTrips(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []),
      );
    fetch(`/api/backend/logistics/vehicles?companyId=${companyId}&limit=100`)
      .then((r) => r.json())
      .then((j) =>
        setVehicles(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      );
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
        `/api/backend/logistics/trip-fuel-usage?companyId=${companyId}&page=1&limit=20`,
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

  function updateForm(patch: Partial<typeof EMPTY_FORM>) {
    setForm((f) => {
      const next = { ...f, ...patch };
      const l = parseFloat(next.litres);
      const u = parseFloat(next.unitPrice);
      if (
        !isNaN(l) &&
        !isNaN(u) &&
        ('litres' in patch || 'unitPrice' in patch) &&
        !('totalCost' in patch)
      ) {
        next.totalCost = (l * u).toString();
      }
      return next;
    });
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setModal('create');
  }

  function openEdit(row: any) {
    setForm({
      tripId: row.tripId ?? '',
      vehicleId: row.vehicleId ?? '',
      fuelSource: row.fuelSource ?? 'PETROL_STATION',
      litres: row.litres ?? '',
      unitPrice: row.unitPrice ?? '',
      totalCost: row.totalCost ?? '',
      odometerBefore: row.odometerBefore ?? '',
      odometerAfter: row.odometerAfter ?? '',
      fuelDate: row.fuelDate ? row.fuelDate.slice(0, 10) : '',
      notes: row.notes ?? '',
    });
    setModal(row);
  }

  async function handleSave() {
    if (!form.tripId || !form.fuelSource || !form.litres || !form.fuelDate) {
      alert('Trip ID, Fuel Source, Litres, and Date are required.');
      return;
    }
    setSaving(true);
    try {
      const isEdit = modal !== null && typeof modal !== 'string';
      const url = isEdit
        ? `/api/backend/logistics/trip-fuel-usage/${(modal as any).id}`
        : '/api/backend/logistics/trip-fuel-usage';
      const method = isEdit ? 'PUT' : 'POST';
      const body = {
        ...form,
        companyId,
        divisionId,
        litres: form.litres !== '' ? Number(form.litres) : undefined,
        unitPrice: form.unitPrice !== '' ? Number(form.unitPrice) : undefined,
        totalCost: form.totalCost !== '' ? Number(form.totalCost) : undefined,
        odometerBefore: form.odometerBefore !== '' ? Number(form.odometerBefore) : undefined,
        odometerAfter: form.odometerAfter !== '' ? Number(form.odometerAfter) : undefined,
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
      setToast({ message: 'Fuel record saved successfully.', type: 'success' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setToast({ message: 'Failed to save Fuel record.', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await backendDelete(`/logistics/trip-fuel-usage/${deleteId}`);
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

      <PageHeader title="Trip Fuel Usage" subtitle="Fuel consumption records per trip" />

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
        actions={companyId ? <Btn onClick={openCreate}>+ New Fuel Record</Btn> : undefined}
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
            {data.total} records
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Record #
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Trip #
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Vehicle Plate
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Fuel Source
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Litres
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Unit Price
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Total Cost
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Odo Before
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    After
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Date
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
                      colSpan={11}
                      className="px-4 py-8 text-center text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No fuel records found.
                    </td>
                  </tr>
                ) : (
                  data.data.map((f: any) => (
                    <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td
                        className={`${tdCls} font-medium`}
                        style={{ color: 'var(--aurora-text)' }}
                      >
                        {f.fuelRecordNumber ?? f.id?.slice(0, 8)}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {f.trip?.tripNumber ?? f.tripId ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {f.vehicle?.registrationNumber ?? f.vehicleId ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {f.fuelSource?.replace(/_/g, ' ') ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {f.litres ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {f.unitPrice != null ? fmtCurrency(f.unitPrice) : '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {f.totalCost != null ? fmtCurrency(f.totalCost) : '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {f.odometerBefore ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {f.odometerAfter ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {f.fuelDate ? fmtDate(f.fuelDate) : '—'}
                      </td>
                      <td className={tdCls}>
                        <div className="flex gap-3">
                          <Btn variant="ghost" size="xs" onClick={() => openEdit(f)}>
                            Edit
                          </Btn>
                          <Btn
                            variant="danger"
                            size="xs"
                            onClick={() => {
                              setDeleteId(f.id);
                              setDeleteLabel(f.fuelRecordNumber || f.id?.slice(0, 8));
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
        title={isEdit ? 'Edit Fuel Record' : 'New Fuel Record'}
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
          <FormSelect
            label="Trip"
            value={form.tripId}
            onChange={(e) => updateForm({ tripId: e.target.value })}
            required
            placeholder="— Select Trip —"
          >
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tripNumber} – {t.origin} → {t.destination}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Vehicle"
            value={form.vehicleId}
            onChange={(e) => updateForm({ vehicleId: e.target.value })}
            placeholder="— Select Vehicle —"
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vehicleCode} – {v.registrationNumber}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Fuel Source"
            value={form.fuelSource}
            onChange={(e) => updateForm({ fuelSource: e.target.value })}
            required
          >
            {FUEL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </FormSelect>
          <DateInput
            label="Fuel Date"
            value={form.fuelDate}
            onChange={(e) => updateForm({ fuelDate: e.target.value })}
            required
          />
          <FormInput
            label="Litres"
            type="number"
            value={form.litres}
            onChange={(e) => updateForm({ litres: e.target.value })}
            placeholder="0.00"
            min="0"
            step="0.01"
            required
          />
          <FormInput
            label="Unit Price (TZS)"
            type="number"
            value={form.unitPrice}
            onChange={(e) => updateForm({ unitPrice: e.target.value })}
            placeholder="0.00"
            min="0"
          />
          <FormInput
            className="sm:col-span-2"
            label="Total Cost (auto-computed)"
            type="number"
            value={form.totalCost}
            onChange={(e) => setForm((f) => ({ ...f, totalCost: e.target.value }))}
            placeholder="0.00"
            min="0"
          />
          <FormInput
            label="Odometer Before"
            type="number"
            value={form.odometerBefore}
            onChange={(e) => updateForm({ odometerBefore: e.target.value })}
            placeholder="km"
            min="0"
          />
          <FormInput
            label="Odometer After"
            type="number"
            value={form.odometerAfter}
            onChange={(e) => updateForm({ odometerAfter: e.target.value })}
            placeholder="km"
            min="0"
          />
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
            onChange={(e) => updateForm({ notes: e.target.value })}
            placeholder="Optional notes…"
            rows={3}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Fuel Record"
        message={`Are you sure you want to delete fuel record "${deleteLabel}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
