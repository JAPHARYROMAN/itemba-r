'use client';

import { useEffect, useState } from 'react';
import { Modal, Btn, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { backendPost } from '@/lib/api-client';

export interface CompanyOption {
  id: string;
  name: string;
}

export interface LeaveBalanceRecord {
  id: string;
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  allocatedDays?: number | string | null;
  carriedForwardDays?: number | string | null;
  usedDays?: number | string | null;
  notes?: string | null;
  company?: { id: string; name: string } | null;
  employee?: { id: string; fullName?: string | null; employeeCode?: string | null } | null;
  leaveType?: { id: string; name: string; code?: string | null } | null;
}

interface EmployeeOption {
  id: string;
  fullName?: string | null;
  employeeCode?: string | null;
}

interface LeaveTypeOption {
  id: string;
  name: string;
  code?: string | null;
}

interface Props {
  /** When present the modal runs in "adjust" mode: the identity fields
   * (company / employee / leave type / year) are locked and only the
   * allocation figures are editable. The backend POST is an upsert, so both
   * modes hit the same endpoint. */
  initial?: LeaveBalanceRecord;
  companies: CompanyOption[];
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  year: string;
  allocatedDays: string;
  carriedForwardDays: string;
  notes: string;
}

function listFromPayload<T>(j: unknown): T[] {
  const data = (j as { data?: unknown })?.data;
  const inner = (data as { data?: unknown })?.data;
  if (Array.isArray(inner)) return inner as T[];
  if (Array.isArray(data)) return data as T[];
  return [];
}

/**
 * AllocationModal — creates or adjusts a leave balance allocation via
 * `POST /api/backend/hr/leave-balances` (backend upsert keyed on
 * company + employee + leave type + year).
 */
export function AllocationModal({ initial, companies, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() =>
    initial
      ? {
          companyId: initial.companyId,
          employeeId: initial.employeeId,
          leaveTypeId: initial.leaveTypeId,
          year: String(initial.year),
          allocatedDays: initial.allocatedDays != null ? String(initial.allocatedDays) : '',
          carriedForwardDays:
            initial.carriedForwardDays != null ? String(initial.carriedForwardDays) : '',
          notes: initial.notes ?? '',
        }
      : {
          companyId: '',
          employeeId: '',
          leaveTypeId: '',
          year: String(new Date().getFullYear()),
          allocatedDays: '',
          carriedForwardDays: '',
          notes: '',
        },
  );
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Cascade employee/leave-type options when the company changes (create mode only).
  useEffect(() => {
    if (initial || !form.companyId) {
      setEmployees([]);
      setLeaveTypes([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/backend/hr/employees?companyId=${form.companyId}&limit=500`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setEmployees(listFromPayload<EmployeeOption>(j));
      })
      .catch(() => {
        if (!cancelled) setEmployees([]);
      });
    fetch(`/api/backend/hr/leave-types?companyId=${form.companyId}&limit=200`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setLeaveTypes(listFromPayload<LeaveTypeOption>(j));
      })
      .catch(() => {
        if (!cancelled) setLeaveTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [initial, form.companyId]);

  const submit = async () => {
    if (!form.companyId || !form.employeeId || !form.leaveTypeId || !form.year) {
      setError('Company, employee, leave type and year are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await backendPost('/hr/leave-balances', {
        companyId: form.companyId,
        employeeId: form.employeeId,
        leaveTypeId: form.leaveTypeId,
        year: Number(form.year),
        allocatedDays: form.allocatedDays === '' ? undefined : Number(form.allocatedDays),
        carriedForwardDays:
          form.carriedForwardDays === '' ? undefined : Number(form.carriedForwardDays),
        notes: form.notes.trim() ? form.notes.trim() : undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save allocation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Adjust Allocation' : 'Allocate Leave Balance'}
      subtitle={
        initial
          ? 'Update the allocated and carried-forward days for this balance'
          : 'Create or update an employee leave allocation for a year'
      }
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={() => void submit()} loading={saving}>
            Save
          </Btn>
        </>
      }
    >
      <form
        id="leave-balance-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        {error && (
          <div
            role="alert"
            className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
          >
            {error}
          </div>
        )}

        {initial ? (
          <div
            className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5 text-sm"
            style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
          >
            <div>
              <span className="block text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                Company
              </span>
              {initial.company?.name ?? initial.companyId}
            </div>
            <div>
              <span className="block text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                Employee
              </span>
              {initial.employee?.fullName ?? initial.employee?.employeeCode ?? initial.employeeId}
            </div>
            <div>
              <span className="block text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                Leave Type
              </span>
              {initial.leaveType?.name ?? initial.leaveTypeId}
            </div>
            <div>
              <span className="block text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                Year · Used Days
              </span>
              {initial.year} · {Number(initial.usedDays ?? 0)} used
            </div>
          </div>
        ) : (
          <>
            <FormSelect
              label="Company"
              aria-label="Company"
              required
              value={form.companyId}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  companyId: e.target.value,
                  employeeId: '',
                  leaveTypeId: '',
                }))
              }
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select company"
            />
            <div className="grid grid-cols-2 gap-3">
              <FormSelect
                label="Employee"
                aria-label="Employee"
                required
                value={form.employeeId}
                onChange={(e) => set('employeeId', e.target.value)}
                options={employees.map((emp) => ({
                  value: emp.id,
                  label: emp.fullName ?? emp.employeeCode ?? emp.id,
                }))}
                placeholder={form.companyId ? 'Select employee' : 'Select company first'}
              />
              <FormSelect
                label="Leave Type"
                aria-label="Leave Type"
                required
                value={form.leaveTypeId}
                onChange={(e) => set('leaveTypeId', e.target.value)}
                options={leaveTypes.map((lt) => ({ value: lt.id, label: lt.name }))}
                placeholder={form.companyId ? 'Select leave type' : 'Select company first'}
              />
            </div>
            <FormInput
              label="Year"
              aria-label="Year"
              type="number"
              required
              min={2000}
              max={2100}
              value={form.year}
              onChange={(e) => set('year', e.target.value)}
            />
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Allocated Days"
            aria-label="Allocated Days"
            type="number"
            min={0}
            step="0.01"
            value={form.allocatedDays}
            onChange={(e) => set('allocatedDays', e.target.value)}
            hint="Total days allocated for the year"
          />
          <FormInput
            label="Carried Forward Days"
            aria-label="Carried Forward Days"
            type="number"
            min={0}
            step="0.01"
            value={form.carriedForwardDays}
            onChange={(e) => set('carriedForwardDays', e.target.value)}
            hint="Days carried over from the prior year"
          />
        </div>
        <FormTextarea
          label="Notes"
          aria-label="Notes"
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </form>
    </Modal>
  );
}
