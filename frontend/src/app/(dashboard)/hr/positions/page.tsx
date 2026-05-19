'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, PageHeader, StatusBadge, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

const POSITION_TYPE_OPTIONS = [
  { value: 'MANAGEMENT', label: 'Management' },
  { value: 'ADMINISTRATION', label: 'Administration' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'SALES', label: 'Sales' },
  { value: 'CASHIER', label: 'Cashier' },
  { value: 'INVENTORY', label: 'Inventory' },
  { value: 'DRIVER', label: 'Driver' },
  { value: 'MECHANIC', label: 'Mechanic' },
  { value: 'PUMP_ATTENDANT', label: 'Pump Attendant' },
  { value: 'STATION_SUPERVISOR', label: 'Station Supervisor' },
  { value: 'PARKING_ATTENDANT', label: 'Parking Attendant' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'CLEANER', label: 'Cleaner' },
  { value: 'RECEPTIONIST', label: 'Receptionist' },
  { value: 'HOUSEKEEPER', label: 'Housekeeper' },
  { value: 'WAITER', label: 'Waiter' },
  { value: 'BARTENDER', label: 'Bartender' },
  { value: 'COOK', label: 'Cook' },
  { value: 'FARM_WORKER', label: 'Farm Worker' },
  { value: 'FARM_SUPERVISOR', label: 'Farm Supervisor' },
  { value: 'MACHINE_OPERATOR', label: 'Machine Operator' },
  { value: 'SITE_WORKER', label: 'Site Worker' },
  { value: 'SITE_SUPERVISOR', label: 'Site Supervisor' },
  { value: 'PROJECT_MANAGER', label: 'Project Manager' },
  { value: 'PROPERTY_MANAGER', label: 'Property Manager' },
  { value: 'OTHER', label: 'Other' },
];

interface Department {
  id: string;
  departmentCode?: string | null;
  name: string;
  companyId?: string;
  divisionId?: string | null;
  branchId?: string | null;
  division?: { id: string; name: string; code?: string | null } | null;
  branch?: { id: string; name: string; code?: string | null } | null;
}

interface Position {
  id: string;
  positionCode: string;
  title: string;
  positionType?: string;
  defaultSalary?: number | string | null;
  companyId?: string;
  company?: { id: string; name: string } | null;
  departmentId?: string | null;
  department?: Department | null;
  status: string;
}

interface FormState {
  positionCode: string;
  title: string;
  companyId: string;
  divisionId: string;
  branchId: string;
  departmentId: string;
  positionType: string;
  defaultSalary: string;
  status: string;
}

const empty: FormState = {
  positionCode: '',
  title: '',
  companyId: '',
  divisionId: '',
  branchId: '',
  departmentId: '',
  positionType: 'OTHER',
  defaultSalary: '',
  status: 'ACTIVE',
};

function unwrapList<T>(payload: any): T[] {
  return Array.isArray(payload.data?.data)
    ? payload.data.data
    : Array.isArray(payload.data)
      ? payload.data
      : [];
}

function labelForPositionType(value?: string) {
  return POSITION_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '-';
}

function hierarchyLabel(department?: Department | null) {
  if (!department) return '-';
  const division = department.division?.code
    ? `${department.division.code} - ${department.division.name}`
    : department.division?.name;
  const branch = department.branch?.code
    ? `${department.branch.code} - ${department.branch.name}`
    : department.branch?.name;
  return [division, branch].filter(Boolean).join(' / ') || '-';
}

export default function PositionsPage() {
  const [rows, setRows] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nextCodePreview, setNextCodePreview] = useState('');
  const { branches, companyOptions, divisionOptions } = useOrgScope(form.companyId, {
    skipEmployees: true,
  });

  const branchOptions = useMemo(
    () =>
      branches
        .filter((b) => !form.divisionId || b.divisionId === form.divisionId)
        .map((b) => ({ value: b.id, label: `${b.code ? b.code + ' - ' : ''}${b.name}` })),
    [branches, form.divisionId],
  );

  const departmentOptions = useMemo(
    () =>
      departments
        .filter((d) => !form.divisionId || (d.division?.id ?? d.divisionId) === form.divisionId)
        .filter((d) => !form.branchId || (d.branch?.id ?? d.branchId) === form.branchId)
        .map((d) => ({
          value: d.id,
          label: `${d.departmentCode ? d.departmentCode + ' - ' : ''}${d.name}${hierarchyLabel(d) !== '-' ? ` (${hierarchyLabel(d)})` : ''}`,
        })),
    [departments, form.branchId, form.divisionId],
  );

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/backend/hr/positions?limit=500');
      const j = await r.json();
      setRows(unwrapList<Position>(j));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    let cancelled = false;
    if (!form.companyId) {
      setDepartments([]);
      return;
    }
    setDepartmentsLoading(true);
    fetch(`/api/backend/hr/departments?companyId=${form.companyId}&status=ACTIVE&limit=500`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setDepartments(unwrapList<Department>(j));
      })
      .catch(() => {
        if (!cancelled) setDepartments([]);
      })
      .finally(() => {
        if (!cancelled) setDepartmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  useEffect(() => {
    if (!showModal || editing || !form.companyId) {
      setNextCodePreview('');
      return;
    }
    let cancelled = false;
    fetch(`/api/backend/hr/positions/next-code?companyId=${form.companyId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setNextCodePreview(j.data?.positionCode ?? j.positionCode ?? '');
      })
      .catch(() => {
        if (!cancelled) setNextCodePreview('');
      });
    return () => {
      cancelled = true;
    };
  }, [showModal, editing, form.companyId]);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setError('');
    setShowModal(true);
  };

  const openEdit = (p: Position) => {
    const department = p.department ?? null;
    setEditing(p);
    setForm({
      positionCode: p.positionCode,
      title: p.title,
      companyId: p.company?.id ?? p.companyId ?? '',
      divisionId: department?.division?.id ?? department?.divisionId ?? '',
      branchId: department?.branch?.id ?? department?.branchId ?? '',
      departmentId: department?.id ?? p.departmentId ?? '',
      positionType: p.positionType ?? 'OTHER',
      defaultSalary: p.defaultSalary == null ? '' : String(p.defaultSalary),
      status: p.status,
    });
    setError('');
    setShowModal(true);
  };

  const handleDepartmentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const departmentId = e.target.value;
    const department = departments.find((d) => d.id === departmentId);
    setForm((p) => ({
      ...p,
      departmentId,
      divisionId: department?.division?.id ?? department?.divisionId ?? p.divisionId,
      branchId: department?.branch?.id ?? department?.branchId ?? '',
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const url = editing ? `/api/backend/hr/positions/${editing.id}` : '/api/backend/hr/positions';
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      companyId: form.companyId,
      departmentId: form.departmentId,
      positionType: form.positionType,
      status: form.status,
      currency: 'TZS',
    };
    if (form.positionCode.trim()) body.positionCode = form.positionCode.trim();
    if (form.defaultSalary) body.defaultSalary = Number(form.defaultSalary);
    try {
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? `Save failed (HTTP ${res.status})`);
        throw new Error(msg);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hr/positions/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Positions"
        subtitle="Job positions linked to departments"
        actions={<Btn variant="primary" onClick={openCreate}>+ Add Position</Btn>}
      />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ color: 'var(--aurora-text-muted)' }} className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Title</th>
                  <th className={thCls}>Company</th>
                  <th className={thCls}>Department</th>
                  <th className={thCls}>Division / Branch</th>
                  <th className={thCls}>Role Type</th>
                  <th className={thCls}>Default Salary</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono`}>{p.positionCode}</td>
                    <td className={`${tdCls} font-medium`}>{p.title}</td>
                    <td className={tdCls}>{p.company?.name ?? '-'}</td>
                    <td className={tdCls}>{p.department?.name ?? '-'}</td>
                    <td className={tdCls}>{hierarchyLabel(p.department)}</td>
                    <td className={tdCls}>{labelForPositionType(p.positionType)}</td>
                    <td className={tdCls}>{p.defaultSalary != null ? `TZS ${(Number.isFinite(Number(p.defaultSalary)) ? Number(p.defaultSalary).toLocaleString('en-TZ') : '0')}` : '-'}</td>
                    <td className={tdCls}><StatusBadge status={p.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(p)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(p.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No positions found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Position' : 'New Position'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="position-form" loading={saving}>Save</Btn>
          </>
        }
      >
        <form id="position-form" onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value, divisionId: '', branchId: '', departmentId: '' }))}
            options={companyOptions}
            placeholder="Select company"
          />
          <FormSelect
            label="Division"
            value={form.divisionId}
            onChange={(e) => setForm((p) => ({ ...p, divisionId: e.target.value, branchId: '', departmentId: '' }))}
            options={divisionOptions}
            placeholder={form.companyId ? 'Select division' : 'Select company first'}
          />
          <FormSelect
            label="Branch / Location"
            value={form.branchId}
            onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value, departmentId: '' }))}
            options={branchOptions}
            placeholder={form.divisionId ? 'Select branch/location if position is branch-specific' : 'Select division first'}
          />
          <FormSelect
            label="Department"
            required
            value={form.departmentId}
            onChange={handleDepartmentChange}
            options={departmentOptions}
            placeholder={departmentsLoading ? 'Loading departments...' : form.companyId ? 'Select department' : 'Select company first'}
          />
          <FormInput
            label="Position Code"
            value={form.positionCode}
            onChange={f('positionCode')}
            placeholder={editing ? '' : (nextCodePreview ? `Auto: ${nextCodePreview}` : 'Auto-generated when blank')}
            hint={editing ? '' : (nextCodePreview && !form.positionCode ? `Will be assigned ${nextCodePreview}` : 'Leave blank to auto-generate')}
          />
          <FormInput label="Title" value={form.title} onChange={f('title')} required />
          <FormSelect label="Role Type" value={form.positionType} onChange={f('positionType')}
            options={POSITION_TYPE_OPTIONS} />
          <FormInput label="Default Salary (TZS)" type="number" value={form.defaultSalary} onChange={f('defaultSalary')} />
          <FormSelect label="Status" value={form.status} onChange={f('status')}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Position"
        message="Are you sure you want to delete this position?"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
