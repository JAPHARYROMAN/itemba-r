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

const MAINTENANCE_TYPES = [
  'SERVICE',
  'REPAIR',
  'INSPECTION',
  'TYRE',
  'OIL_CHANGE',
  'BREAKDOWN',
  'OTHER',
];

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

function fmtCurrency(n: number) {
  return `TZS ${new Intl.NumberFormat('en-US').format(n)}`;
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const EMPTY_FORM = {
  vehicleId: '',
  maintenanceType: 'SERVICE',
  maintenanceDate: '',
  odometerReading: '',
  description: '',
  costAmount: '',
  currency: 'TZS',
  nextServiceDate: '',
  nextServiceOdometer: '',
  notes: '',
};

export default function MaintenancePage() {
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
        `/api/backend/logistics/vehicle-maintenance?companyId=${companyId}&page=1&limit=20`,
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
      vehicleId: row.vehicleId ?? '',
      maintenanceType: row.maintenanceType ?? 'SERVICE',
      maintenanceDate: row.maintenanceDate ? row.maintenanceDate.slice(0, 10) : '',
      odometerReading: row.odometerReading ?? '',
      description: row.description ?? '',
      costAmount: row.costAmount ?? '',
      currency: row.currency ?? 'TZS',
      nextServiceDate: row.nextServiceDate ? row.nextServiceDate.slice(0, 10) : '',
      nextServiceOdometer: row.nextServiceOdometer ?? '',
      notes: row.notes ?? '',
    });
    setModal(row);
  }

  async function handleSave() {
    if (!form.vehicleId || !form.maintenanceDate) {
      alert('Vehicle ID and Maintenance Date are required.');
      return;
    }
    setSaving(true);
    try {
      const isEdit = modal !== null && typeof modal !== 'string';
      const url = isEdit
        ? `/api/backend/logistics/vehicle-maintenance/${(modal as any).id}`
        : '/api/backend/logistics/vehicle-maintenance';
      const method = isEdit ? 'PUT' : 'POST';
      const body = {
        ...form,
        companyId,
        divisionId,
        odometerReading: form.odometerReading !== '' ? Number(form.odometerReading) : undefined,
        costAmount: form.costAmount !== '' ? Number(form.costAmount) : undefined,
        nextServiceOdometer:
          form.nextServiceOdometer !== '' ? Number(form.nextServiceOdometer) : undefined,
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
      setToast({ message: 'Maintenance record saved successfully.', type: 'success' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setToast({ message: 'Failed to save Maintenance record.', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await backendDelete(`/logistics/vehicle-maintenance/${deleteId}`);
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

      <PageHeader title="Vehicle Maintenance" subtitle="Maintenance records and service history" />

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
        actions={companyId ? <Btn onClick={openCreate}>+ New Record</Btn> : undefined}
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
                    Maintenance #
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Vehicle
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Type
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Date
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Description
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Cost
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
                      colSpan={8}
                      className="px-4 py-8 text-center text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No maintenance records found.
                    </td>
                  </tr>
                ) : (
                  data.data.map((m: any) => (
                    <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td
                        className={`${tdCls} font-medium`}
                        style={{ color: 'var(--aurora-text)' }}
                      >
                        {m.maintenanceNumber}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {m.vehicle?.registrationNumber ?? m.vehicleId ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {m.maintenanceType?.replace(/_/g, ' ') ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {m.maintenanceDate ? fmtDate(m.maintenanceDate) : '—'}
                      </td>
                      <td
                        className={`${tdCls} max-w-xs truncate`}
                        style={{ color: 'var(--aurora-text)' }}
                      >
                        {m.description ?? '—'}
                      </td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                        {m.costAmount != null ? fmtCurrency(m.costAmount) : '—'}
                      </td>
                      <td className={tdCls}>
                        <StatusBadge status={m.status} />
                      </td>
                      <td className={tdCls}>
                        <div className="flex gap-3">
                          <Btn variant="ghost" size="xs" onClick={() => openEdit(m)}>
                            Edit
                          </Btn>
                          <Btn
                            variant="danger"
                            size="xs"
                            onClick={() => {
                              setDeleteId(m.id);
                              setDeleteLabel(m.maintenanceNumber || m.id?.slice(0, 8));
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
        title={isEdit ? 'Edit Maintenance Record' : 'New Maintenance Record'}
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
            label="Vehicle ID"
            value={form.vehicleId}
            onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}
            placeholder="Vehicle ID"
            required
          />
          <FormSelect
            label="Maintenance Type"
            value={form.maintenanceType}
            onChange={(e) => setForm((f) => ({ ...f, maintenanceType: e.target.value }))}
          >
            {MAINTENANCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </FormSelect>
          <DateInput
            label="Maintenance Date"
            value={form.maintenanceDate}
            onChange={(e) => setForm((f) => ({ ...f, maintenanceDate: e.target.value }))}
            required
          />
          <FormInput
            label="Odometer Reading (km)"
            type="number"
            value={form.odometerReading}
            onChange={(e) => setForm((f) => ({ ...f, odometerReading: e.target.value }))}
            placeholder="km"
            min="0"
          />
          <FormTextarea
            className="sm:col-span-2"
            label="Description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="What was done"
            rows={2}
          />
          <FormInput
            label="Cost Amount"
            type="number"
            value={form.costAmount}
            onChange={(e) => setForm((f) => ({ ...f, costAmount: e.target.value }))}
            placeholder="0.00"
            min="0"
          />
          <FormInput
            label="Currency"
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
            placeholder="TZS"
          />
          <DateInput
            label="Next Service Date"
            value={form.nextServiceDate}
            onChange={(e) => setForm((f) => ({ ...f, nextServiceDate: e.target.value }))}
          />
          <FormInput
            label="Next Service Odometer (km)"
            type="number"
            value={form.nextServiceOdometer}
            onChange={(e) => setForm((f) => ({ ...f, nextServiceOdometer: e.target.value }))}
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
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Optional notes…"
            rows={3}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Maintenance Record"
        message={`Are you sure you want to delete maintenance record "${deleteLabel}"? This cannot be undone.`}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
