'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  PageHeader,
  FormInput,
  FormSelect,
  ConfirmDialog,
  Modal,
  Btn,
  PageToolbar,
  PageSpinner,
  FormTextarea,
} from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface LinkedDocument {
  id: string;
  title: string;
  fileName: string;
  fileSizeBytes?: number | null;
  mimeType?: string | null;
  expiryDate?: string | null;
  status?: string | null;
  version?: number | null;
}

interface HRDocument {
  id: string;
  employee?: { fullName?: string; employeeCode?: string } | string;
  employeeId?: string;
  category?: string;
  documentCategory?: string;
  documentId?: string;
  document?: LinkedDocument;
  documentRef?: string;
  isSensitive: boolean;
  documentDate?: string;
  createdAt?: string;
}

function formatBytes(n?: number | null) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface FormState {
  companyId: string;
  employeeId: string;
  category: string;
  documentRef: string;
  isSensitive: string;
  documentDate: string;
  notes: string;
}

const empty: FormState = {
  companyId: '',
  employeeId: '',
  category: 'CONTRACT',
  documentRef: '',
  isSensitive: 'false',
  documentDate: '',
  notes: '',
};

export default function HRDocumentsPage() {
  const [rows, setRows] = useState<HRDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [empFilter, setEmpFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, {
    skipBranches: true,
    skipDivisions: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (empFilter) params.set('employeeId', empFilter);
    if (catFilter) params.set('category', catFilter);
    const r = await fetch(`/api/backend/hr/hr-documents?${params}`);
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  }, [catFilter, empFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { companyId: _companyId, ...payload } = form;
    void _companyId;
    await fetch('/api/backend/hr/hr-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, isSensitive: form.isSensitive === 'true' }),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hr/hr-documents/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    load();
  };

  const f =
    (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const bool = (v: boolean) =>
    v ? (
      <span className="text-red-600 text-xs font-medium">Yes</span>
    ) : (
      <span className="text-slate-400 text-xs">No</span>
    );

  return (
    <div className="p-6">
      <PageHeader title="HR Documents" subtitle="Employee document records and references" />
      <PageToolbar
        filters={
          <>
            <input
              type="text"
              placeholder="Filter by employee…"
              value={empFilter}
              onChange={(e) => setEmpFilter(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            />
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            >
              <option value="">All Categories</option>
              <option value="CONTRACT">Contract</option>
              <option value="CERTIFICATE">Certificate</option>
              <option value="ID">ID</option>
              <option value="PAYSLIP">Payslip</option>
              <option value="WARNING">Warning Letter</option>
              <option value="OTHER">Other</option>
            </select>
          </>
        }
        actions={
          <Btn
            variant="primary"
            onClick={() => {
              setForm(empty);
              setShowModal(true);
            }}
          >
            + Link Document
          </Btn>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead
                className="bg-slate-50 border-b border-slate-100"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Category</th>
                  <th className={thCls}>Title</th>
                  <th className={thCls}>File</th>
                  <th className={thCls}>Size</th>
                  <th className={thCls}>Expiry</th>
                  <th className={thCls}>Sensitive</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((d) => {
                  const employeeLabel =
                    typeof d.employee === 'string'
                      ? d.employee
                      : (d.employee?.fullName ?? d.employee?.employeeCode ?? d.employeeId ?? '—');
                  const expiry = d.document?.expiryDate;
                  const expired = expiry ? new Date(expiry) < new Date() : false;
                  return (
                    <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{employeeLabel}</td>
                      <td className={tdCls}>{d.documentCategory ?? d.category ?? '—'}</td>
                      <td className={tdCls}>{d.document?.title ?? '—'}</td>
                      <td className={`${tdCls} font-mono text-xs`}>
                        {d.document?.fileName ?? '—'}
                      </td>
                      <td className={tdCls}>{formatBytes(d.document?.fileSizeBytes)}</td>
                      <td className={tdCls}>
                        {expiry ? (
                          <span className={expired ? 'text-red-600 font-medium' : ''}>
                            {new Date(expiry).toLocaleDateString('en-GB')}
                            {expired && ' (expired)'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={tdCls}>{bool(d.isSensitive)}</td>
                      <td className={tdCls}>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(d.id)}>
                          Delete
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="text-center py-8 text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No documents found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Link HR Document"
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" type="submit" form="hr-document-form" loading={saving}>
              Save
            </Btn>
          </>
        }
      >
        <form id="hr-document-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value, employeeId: '' }))}
            options={companyOptions}
            placeholder="Select company"
          />
          <FormSelect
            label="Employee"
            required
            value={form.employeeId}
            onChange={f('employeeId')}
            options={employeeOptions}
            placeholder={form.companyId ? 'Select employee' : 'Select company first'}
          />
          <FormSelect
            label="Category"
            value={form.category}
            onChange={f('category')}
            options={[
              { value: 'CONTRACT', label: 'Contract' },
              { value: 'CERTIFICATE', label: 'Certificate' },
              { value: 'ID', label: 'ID Document' },
              { value: 'PAYSLIP', label: 'Payslip' },
              { value: 'WARNING', label: 'Warning Letter' },
              { value: 'OTHER', label: 'Other' },
            ]}
          />
          <FormInput
            label="Document Reference / URL"
            value={form.documentRef}
            onChange={f('documentRef')}
          />
          <FormInput
            label="Document Date"
            type="date"
            value={form.documentDate}
            onChange={f('documentDate')}
          />
          <FormSelect
            label="Sensitive?"
            value={form.isSensitive}
            onChange={f('isSensitive')}
            options={[
              { value: 'false', label: 'No' },
              { value: 'true', label: 'Yes' },
            ]}
          />
          <FormTextarea label="Notes" value={form.notes} onChange={f('notes')} rows={2} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Document"
        message="Remove this HR document record?"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
