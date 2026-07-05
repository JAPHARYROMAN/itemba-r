'use client';

import { useCallback, useEffect, useState } from 'react';
import { Btn, ConfirmDialog, FormInput, FormSelect, FormTextarea, Modal, PageSpinner, showToast } from '@/components/ui';
import { ApiError, backendDelete, backendList, backendPatch, backendPost } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }

interface SecurityPolicy {
  id: string;
  policyCode: string;
  name: string;
  policyType: string;
  settings?: Record<string, unknown> | null;
  isActive: boolean;
  companyId?: string | null;
  createdAt?: string;
}

const POLICY_TYPES = ['PASSWORD', 'SESSION', 'TWO_FACTOR', 'LOGIN_ATTEMPT', 'API_SECURITY', 'DATA_ACCESS', 'EXPORT_SECURITY', 'DEVICE_SECURITY', 'GENERAL'];

interface PolicyForm {
  policyCode: string; name: string; policyType: string; companyId: string; isActive: string; settings: string;
}
const BLANK: PolicyForm = { policyCode: '', name: '', policyType: 'GENERAL', companyId: '', isActive: 'true', settings: '{}' };

function PolicyModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: SecurityPolicy; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<PolicyForm>(() => initial ? {
    policyCode: initial.policyCode,
    name: initial.name,
    policyType: initial.policyType,
    companyId: initial.companyId ?? '',
    isActive: String(initial.isActive),
    settings: JSON.stringify(initial.settings ?? {}, null, 2),
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof PolicyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.policyType) { setError('Name and policy type are required'); return; }
    let settings: unknown;
    try {
      settings = form.settings.trim() ? JSON.parse(form.settings) : {};
    } catch {
      setError('Settings must be valid JSON');
      return;
    }
    setSaving(true); setError('');
    try {
      if (mode === 'create') {
        await backendPost('security-policies', {
          policyCode: form.policyCode || undefined,
          name: form.name,
          policyType: form.policyType,
          settings,
          isActive: form.isActive === 'true',
          companyId: form.companyId || undefined,
        });
      } else {
        await backendPatch(`security-policies/${initial!.id}`, {
          name: form.name,
          policyType: form.policyType,
          settings,
          isActive: form.isActive === 'true',
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Security Policy' : 'Edit Security Policy'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Policy Code" value={form.policyCode} onChange={(e) => set('policyCode', e.target.value)}
          disabled={mode === 'edit'} hint={mode === 'create' ? 'Leave blank to auto-generate' : undefined} />
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <FormSelect label="Type" required value={form.policyType} onChange={(e) => set('policyType', e.target.value)}>
          {POLICY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Company" value={form.companyId} onChange={(e) => set('companyId', e.target.value)}
          disabled={mode === 'edit'} placeholder="All companies">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.isActive} onChange={(e) => set('isActive', e.target.value)}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </FormSelect>
        <div className="col-span-2">
          <FormTextarea label="Settings (JSON)" rows={5} value={form.settings} onChange={(e) => set('settings', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

export default function SecurityPoliciesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('security.policies.manage');

  const [data, setData] = useState<SecurityPolicy[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SecurityPolicy | null>(null);
  const [deleting, setDeleting] = useState<SecurityPolicy | null>(null);

  const load = useCallback(() => {
    backendList<SecurityPolicy>('security-policies')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canManage) return;
    backendList<Company>('companies', { query: { limit: 100 } })
      .then(setCompanies)
      .catch(() => {});
  }, [canManage]);

  const onSaved = () => { setCreating(false); setEditing(null); load(); };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await backendDelete(`security-policies/${deleting.id}`);
      showToast('success', 'Policy deleted');
      setDeleting(null);
      load();
    } catch (err) {
      showToast('error', 'Delete failed', err instanceof ApiError ? err.message : 'Unexpected error');
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Security Policies</h1>
          <p className="text-gray-500 mt-1">Manage system-wide security policy configurations</p>
        </div>
        {canManage && <Btn variant="primary" onClick={() => setCreating(true)}>+ New Policy</Btn>}
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Policy Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Created At</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="px-4 py-8 text-center text-gray-400">
                    No security policies found
                  </td>
                </tr>
              ) : (
                data.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{row.policyCode}</td>
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3">{row.policyType}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${row.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {row.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—'}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(row)}>Edit</Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(row)}>Delete</Btn>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating && <PolicyModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <PolicyModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Policy"
        message={`Delete security policy "${deleting?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
