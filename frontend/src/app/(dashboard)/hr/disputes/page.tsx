'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  Modal,
  PageHeader,
  PageSpinner,
  PageToolbar,
  StatusBadge,
} from '@/components/ui';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface EmployeeOption {
  id: string;
  employeeCode: string;
  fullName: string;
  firstName: string;
  lastName: string;
}

interface DisputeRow {
  id: string;
  disputeNumber: string;
  companyId: string;
  employeeId: string;
  type: string;
  status: string;
  raisedAt: string;
  summary: string;
  cmaReferenceNumber: string | null;
  resolvedAt: string | null;
  employee?: {
    fullName: string | null;
    firstName: string;
    lastName: string;
    employeeCode: string;
    department?: { name: string } | null;
    position?: { title: string } | null;
  } | null;
  raisedBy?: { fullName: string } | null;
}

const TYPE_OPTIONS = [
  { value: 'GRIEVANCE', label: 'Grievance' },
  { value: 'WAGE_DISPUTE', label: 'Wage dispute' },
  { value: 'WORKING_CONDITIONS', label: 'Working conditions' },
  { value: 'HARASSMENT', label: 'Harassment' },
  { value: 'DISCRIMINATION', label: 'Discrimination' },
  { value: 'UNFAIR_TERMINATION', label: 'Unfair termination' },
  { value: 'CONSTRUCTIVE_DISMISSAL', label: 'Constructive dismissal' },
  { value: 'CONTRACT_BREACH', label: 'Contract breach' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'RAISED', label: 'Raised' },
  { value: 'INTERNAL_MEDIATION', label: 'Internal mediation' },
  { value: 'CMA_REFERRED', label: 'CMA referred' },
  { value: 'CMA_HEARING', label: 'CMA hearing' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DISMISSED', label: 'Dismissed' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
];

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function DisputesPage() {
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    companyId: '',
    employeeId: '',
    type: 'GRIEVANCE',
    raisedAt: new Date().toISOString().slice(0, 10),
    summary: '',
    initialPosition: '',
  });

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (!form.companyId) {
      setEmployees([]);
      return;
    }
    fetch(`/api/backend/hr/employees?companyId=${form.companyId}&limit=500`)
      .then((r) => r.json())
      .then((j) =>
        setEmployees(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setEmployees([]));
  }, [form.companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCompany) params.set('companyId', filterCompany);
    if (filterStatus) params.set('status', filterStatus);
    const r = await fetch(`/api/backend/hr/employment-disputes?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [filterCompany, filterStatus]);
  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyId || !form.employeeId || !form.summary.trim()) {
      setError('Company, employee, and summary are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/backend/hr/employment-disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: form.companyId,
          employeeId: form.employeeId,
          type: form.type,
          raisedAt: form.raisedAt,
          summary: form.summary.trim(),
          initialPosition: form.initialPosition || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Save failed'),
        );
      }
      setShowCreate(false);
      setForm({
        companyId: '',
        employeeId: '',
        type: 'GRIEVANCE',
        raisedAt: new Date().toISOString().slice(0, 10),
        summary: '',
        initialPosition: '',
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Employment Disputes"
        subtitle="Grievances, dismissal challenges, wage disputes — workflow under Tanzania's Employment & Labour Relations Act, 2004."
        breadcrumbs={[{ label: 'HR', href: '/hr' }, { label: 'Disputes' }]}
      />

      <PageToolbar
        filters={
          <>
            <FormSelect
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              options={[
                { value: '', label: 'All companies' },
                ...companies.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <FormSelect
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              options={STATUS_OPTIONS}
            />
          </>
        }
        actions={
          <Btn
            variant="primary"
            onClick={() => {
              setError('');
              setShowCreate(true);
            }}
          >
            + New dispute
          </Btn>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">No disputes recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead
                className="bg-slate-50 border-b border-slate-100"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Dispute #
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Employee
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Type
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Raised
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    CMA #
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">{r.disputeNumber}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium">
                        {r.employee?.fullName ?? `${r.employee?.firstName} ${r.employee?.lastName}`}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {r.employee?.employeeCode}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs">{r.type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 text-xs">{fmtDate(r.raisedAt)}</td>
                    <td className="px-4 py-2 text-xs font-mono">{r.cmaReferenceNumber ?? '—'}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <Link href={`/hr/disputes/${r.id}`}>
                        <Btn variant="ghost" size="xs">
                          Open
                        </Btn>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New employment dispute"
        size="lg"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="dispute-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="dispute-form" onSubmit={submit} className="space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormSelect
              label="Company *"
              value={form.companyId}
              onChange={(e) =>
                setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '' }))
              }
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select"
            />
            <FormSelect
              label="Employee *"
              value={form.employeeId}
              onChange={(e) => setForm((p) => ({ ...p, employeeId: e.target.value }))}
              options={employees.map((e) => ({
                value: e.id,
                label: `${e.employeeCode} — ${e.fullName ?? `${e.firstName} ${e.lastName}`}`,
              }))}
              placeholder={form.companyId ? 'Select' : 'Pick company first'}
              disabled={!form.companyId}
            />
            <FormSelect
              label="Dispute type"
              value={form.type}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
              options={TYPE_OPTIONS}
            />
            <FormInput
              label="Raised on"
              type="date"
              value={form.raisedAt}
              onChange={(e) => setForm((p) => ({ ...p, raisedAt: e.target.value }))}
            />
          </div>
          <FormInput
            label="Summary *"
            value={form.summary}
            onChange={(e) => setForm((p) => ({ ...p, summary: e.target.value }))}
            hint="One-line description of the dispute"
          />
          <FormInput
            label="Initial position"
            value={form.initialPosition}
            onChange={(e) => setForm((p) => ({ ...p, initialPosition: e.target.value }))}
            hint="Employee's claimed remedy or initial demand"
          />
        </form>
      </Modal>
    </div>
  );
}
