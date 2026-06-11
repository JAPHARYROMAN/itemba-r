'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  ConfirmDialog,
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
interface Branch {
  id: string;
  name: string;
  code: string;
  companyId: string;
}

interface OshaRow {
  id: string;
  companyId: string;
  branchId: string;
  certificateNumber: string;
  registrationType: string;
  issuedAt: string | null;
  expiresAt: string;
  inspectorName: string | null;
  inspectorContact: string | null;
  riskClassification: string | null;
  status: string;
  notes: string | null;
  company?: { name: string; code: string } | null;
  branch?: { name: string; code: string; location: string | null } | null;
}

interface FormState {
  companyId: string;
  branchId: string;
  certificateNumber: string;
  registrationType: string;
  issuedAt: string;
  expiresAt: string;
  inspectorName: string;
  inspectorContact: string;
  riskClassification: string;
  status: string;
  notes: string;
}

const blank: FormState = {
  companyId: '',
  branchId: '',
  certificateNumber: '',
  registrationType: 'GENERAL',
  issuedAt: '',
  expiresAt: '',
  inspectorName: '',
  inspectorContact: '',
  riskClassification: '',
  status: 'ACTIVE',
  notes: '',
};

const TYPE_OPTIONS = [
  { value: 'GENERAL', label: 'General workplace' },
  { value: 'PETROLEUM_FACILITY', label: 'Petroleum facility' },
  { value: 'CHEMICAL_PLANT', label: 'Chemical plant' },
  { value: 'HAZARDOUS_PROCESS', label: 'Hazardous process' },
  { value: 'CONSTRUCTION_SITE', label: 'Construction site' },
  { value: 'WAREHOUSE', label: 'Warehouse' },
  { value: 'OFFICE', label: 'Office' },
  { value: 'OTHER', label: 'Other' },
];

const RISK_OPTIONS = [
  { value: '', label: 'Not classified' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING_RENEWAL', label: 'Pending renewal' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
function daysUntil(d: string): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
}

export default function OshaRegistrationsPage() {
  const [rows, setRows] = useState<OshaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<OshaRow | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');

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
      setBranches([]);
      return;
    }
    fetch(`/api/backend/branches?companyId=${form.companyId}&limit=200`)
      .then((r) => r.json())
      .then((j) =>
        setBranches(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      )
      .catch(() => setBranches([]));
  }, [form.companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCompany) params.set('companyId', filterCompany);
    const r = await fetch(`/api/backend/hr/osha-registrations?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [filterCompany]);
  useEffect(() => {
    load();
  }, [load]);

  const expiringSoon = useMemo(
    () =>
      rows.filter((r) => {
        const days = daysUntil(r.expiresAt);
        return r.status === 'ACTIVE' && days <= 60 && days > 0;
      }),
    [rows],
  );

  const expired = useMemo(
    () => rows.filter((r) => r.status !== 'EXPIRED' && daysUntil(r.expiresAt) < 0),
    [rows],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(blank);
    setError('');
    setShowModal(true);
  };
  const openEdit = (row: OshaRow) => {
    setEditing(row);
    setForm({
      companyId: row.companyId,
      branchId: row.branchId,
      certificateNumber: row.certificateNumber,
      registrationType: row.registrationType,
      issuedAt: row.issuedAt?.slice(0, 10) ?? '',
      expiresAt: row.expiresAt.slice(0, 10),
      inspectorName: row.inspectorName ?? '',
      inspectorContact: row.inspectorContact ?? '',
      riskClassification: row.riskClassification ?? '',
      status: row.status,
      notes: row.notes ?? '',
    });
    setError('');
    setShowModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyId || !form.branchId || !form.certificateNumber || !form.expiresAt) {
      setError('Company, branch, certificate # and expiry are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        branchId: form.branchId,
        certificateNumber: form.certificateNumber.trim(),
        registrationType: form.registrationType,
        expiresAt: form.expiresAt,
        status: form.status,
      };
      if (form.issuedAt) body.issuedAt = form.issuedAt;
      if (form.inspectorName) body.inspectorName = form.inspectorName;
      if (form.inspectorContact) body.inspectorContact = form.inspectorContact;
      if (form.riskClassification) body.riskClassification = form.riskClassification;
      if (form.notes) body.notes = form.notes;
      const url = editing
        ? `/api/backend/hr/osha-registrations/${editing.id}`
        : '/api/backend/hr/osha-registrations';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Save failed'),
        );
      }
      setShowModal(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hr/osha-registrations/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="OSHA Registrations"
        subtitle="Workplace registrations under the Occupational Safety & Health Authority Act, 2003 — track per-branch certificates, inspectors and renewal expiries."
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'OSHA Registrations' },
        ]}
      />

      {expired.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
          <strong>
            {expired.length} certificate{expired.length === 1 ? '' : 's'} expired
          </strong>{' '}
          — renew or update status before the next OSHA inspection.
        </div>
      )}
      {expiringSoon.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          {expiringSoon.length} certificate{expiringSoon.length === 1 ? '' : 's'} expiring within 60
          days. Schedule renewal inspections now.
        </div>
      )}

      <PageToolbar
        filters={
          <FormSelect
            value={filterCompany}
            onChange={(e) => setFilterCompany(e.target.value)}
            options={[
              { value: '', label: 'All companies' },
              ...companies.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        }
        actions={
          <Btn variant="primary" onClick={openCreate}>
            + New registration
          </Btn>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No OSHA registrations on file.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead
                className="bg-slate-50 border-b border-slate-100"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Certificate #
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Branch
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Type
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Risk
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                    Expires
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
                {rows.map((r) => {
                  const days = daysUntil(r.expiresAt);
                  const expClass =
                    days < 0
                      ? 'text-red-700 font-semibold'
                      : days <= 60
                        ? 'text-amber-700 font-semibold'
                        : '';
                  return (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs">{r.certificateNumber}</td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{r.branch?.name ?? '—'}</div>
                        {r.branch?.location && (
                          <div className="text-xs text-slate-500">{r.branch.location}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">{r.registrationType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2 text-xs">
                        {r.riskClassification ? <StatusBadge status={r.riskClassification} /> : '—'}
                      </td>
                      <td className={`px-4 py-2 text-sm ${expClass}`}>
                        {fmtDate(r.expiresAt)}
                        {days >= 0 && days <= 60 && <span className="ml-1 text-xs">({days}d)</span>}
                        {days < 0 && <span className="ml-1 text-xs">({-days}d ago)</span>}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(r)}>
                          Edit
                        </Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleteId(r.id)}>
                          Delete
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit OSHA registration' : 'New OSHA registration'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="osha-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="osha-form" onSubmit={submit} className="space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormSelect
              label="Company *"
              value={form.companyId}
              onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value, branchId: '' }))}
              options={companies.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
              placeholder="Select"
              disabled={!!editing}
            />
            <FormSelect
              label="Branch *"
              value={form.branchId}
              onChange={(e) => setForm((p) => ({ ...p, branchId: e.target.value }))}
              options={branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))}
              placeholder={form.companyId ? 'Select' : 'Pick company first'}
              disabled={!form.companyId}
            />
            <FormInput
              label="Certificate # *"
              value={form.certificateNumber}
              onChange={(e) => setForm((p) => ({ ...p, certificateNumber: e.target.value }))}
              required
            />
            <FormSelect
              label="Registration type"
              value={form.registrationType}
              onChange={(e) => setForm((p) => ({ ...p, registrationType: e.target.value }))}
              options={TYPE_OPTIONS}
            />
            <FormInput
              label="Issued date"
              type="date"
              value={form.issuedAt}
              onChange={(e) => setForm((p) => ({ ...p, issuedAt: e.target.value }))}
            />
            <FormInput
              label="Expires *"
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))}
              required
            />
            <FormInput
              label="Inspector name"
              value={form.inspectorName}
              onChange={(e) => setForm((p) => ({ ...p, inspectorName: e.target.value }))}
            />
            <FormInput
              label="Inspector contact"
              value={form.inspectorContact}
              onChange={(e) => setForm((p) => ({ ...p, inspectorContact: e.target.value }))}
            />
            <FormSelect
              label="Risk classification"
              value={form.riskClassification}
              onChange={(e) => setForm((p) => ({ ...p, riskClassification: e.target.value }))}
              options={RISK_OPTIONS}
            />
            <FormSelect
              label="Status"
              value={form.status}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
              options={STATUS_OPTIONS}
            />
            <div className="col-span-2">
              <FormInput
                label="Notes"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete OSHA registration"
        message="Soft-delete this registration? Audit trail is retained but the row will no longer appear in lists."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
