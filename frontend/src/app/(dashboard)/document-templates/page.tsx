'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageSpinner, Modal, Btn, ConfirmDialog, FormInput, FormSelect, FormTextarea, showToast } from '@/components/ui';
import { backendPost, backendPut, backendDelete, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

const TEMPLATE_TYPES = [
  'SALES_INVOICE', 'RECEIPT', 'DELIVERY_NOTE', 'PURCHASE_ORDER', 'QUOTATION', 'PROFORMA_INVOICE',
  'PAYSLIP', 'RENT_INVOICE', 'PARKING_RECEIPT', 'FUEL_SHIFT_REPORT', 'HOTEL_BOOKING_INVOICE',
  'RESTAURANT_RECEIPT', 'BAR_RECEIPT', 'CONTRACT', 'TAX_RETURN', 'CUSTOMER_STATEMENT',
  'SUPPLIER_STATEMENT', 'MANAGEMENT_REPORT', 'OTHER',
];
const FORMATS = ['HTML', 'PDF_READY_HTML', 'TEXT', 'JSON'];

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  DRAFT: 'bg-amber-100 text-amber-700',
  INACTIVE: 'bg-gray-100 text-gray-600',
  ARCHIVED: 'bg-gray-100 text-gray-500',
};

interface Company { id: string; name: string }

interface DocumentTemplate {
  id: string;
  templateCode: string;
  companyId?: string | null;
  name: string;
  templateType: string;
  format: string;
  content: string;
  isDefault: boolean;
  status: string;
}

interface TemplateForm {
  templateCode: string; name: string; templateType: string; format: string;
  companyId: string; content: string; isDefault: boolean;
}
const BLANK: TemplateForm = {
  templateCode: '', name: '', templateType: 'SALES_INVOICE', format: 'HTML',
  companyId: '', content: '', isDefault: false,
};

function TemplateModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: DocumentTemplate; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TemplateForm>(() => initial ? {
    templateCode: initial.templateCode,
    name: initial.name,
    templateType: initial.templateType,
    format: initial.format,
    companyId: initial.companyId ?? '',
    content: initial.content ?? '',
    isDefault: initial.isDefault,
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof TemplateForm, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.templateCode || !form.name || !form.content) { setError('Template code, name and content are required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        templateCode: form.templateCode,
        name: form.name,
        templateType: form.templateType,
        format: form.format,
        companyId: form.companyId || undefined,
        content: form.content,
        isDefault: form.isDefault,
      };
      if (mode === 'create') await backendPost('/document-templates', body);
      else await backendPut(`/document-templates/${initial!.id}`, body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Template' : 'Edit Template'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Template Code" required value={form.templateCode} onChange={(e) => set('templateCode', e.target.value)} />
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <FormSelect label="Template Type" required value={form.templateType} onChange={(e) => set('templateType', e.target.value)}>
          {TEMPLATE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Format" value={form.format} onChange={(e) => set('format', e.target.value)}>
          {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </FormSelect>
        <FormSelect label="Company" value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="All companies">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <label className="flex items-center gap-2 text-sm self-end pb-2" style={{ color: 'var(--aurora-text)' }}>
          <input type="checkbox" checked={form.isDefault} onChange={(e) => set('isDefault', e.target.checked)} /> Default template
        </label>
        <div className="col-span-2">
          <FormTextarea label="Content" required rows={8} value={form.content} onChange={(e) => set('content', e.target.value)} hint="HTML or text body of the template" />
        </div>
      </div>
    </Modal>
  );
}

export default function DocumentTemplatesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('document_templates.create');
  const canUpdate = hasPermission('document_templates.update');
  const canDelete = hasPermission('document_templates.delete');
  const showActions = canUpdate || canDelete;

  const [data, setData] = useState<DocumentTemplate[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [deleting, setDeleting] = useState<DocumentTemplate | null>(null);
  const [actionLoading, setActionLoading] = useState('');

  const load = useCallback(() => {
    fetch('/api/backend/document-templates')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canCreate && !canUpdate) return;
    fetch('/api/backend/companies?limit=100').then(r => r.json())
      .then(res => setCompanies(res.data?.data ?? res.data ?? []))
      .catch(() => {});
  }, [canCreate, canUpdate]);

  const onSaved = () => {
    setCreating(false); setEditing(null); load();
    showToast('success', 'Template saved');
  };

  const toggleActive = async (t: DocumentTemplate) => {
    setActionLoading(t.id);
    try {
      await backendPost(`/document-templates/${t.id}/${t.status === 'ACTIVE' ? 'deactivate' : 'activate'}`);
      showToast('success', `Template ${t.status === 'ACTIVE' ? 'deactivated' : 'activated'}`);
      load();
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Action failed');
    } finally { setActionLoading(''); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await backendDelete(`/document-templates/${deleting.id}`);
      showToast('success', 'Template deleted');
      setDeleting(null); load();
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Delete failed');
      setDeleting(null);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Document Templates</h1>
          <p className="text-gray-500 mt-1">Manage document and report templates</p>
        </div>
        {canCreate && (
          <button onClick={() => setCreating(true)} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
            + New Template
          </button>
        )}
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Template Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Template Type</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Default</th>
                <th className="px-4 py-3">Status</th>
                {showActions && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={showActions ? 7 : 6} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.templateCode}</td>
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3">{row.templateType}</td>
                  <td className="px-4 py-3">{row.format}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.isDefault ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                      {row.isDefault ? 'Default' : 'Custom'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {row.status}
                    </span>
                  </td>
                  {showActions && (
                    <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                      {canUpdate && (
                        <button onClick={() => setEditing(row)} className="text-blue-600 hover:underline">Edit</button>
                      )}
                      {canUpdate && (
                        <button onClick={() => toggleActive(row)} disabled={actionLoading === row.id} className="text-gray-500 hover:underline disabled:opacity-50">
                          {actionLoading === row.id ? '…' : row.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                      {canDelete && row.status !== 'ACTIVE' && (
                        <button onClick={() => setDeleting(row)} className="text-red-500 hover:underline">Delete</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <TemplateModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <TemplateModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Template"
        message={`Delete template "${deleting?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
