'use client';
import { useCallback, useEffect, useState } from 'react';
import { PageSpinner, Modal, Btn, ConfirmDialog, FormInput, FormSelect, FormTextarea, showToast } from '@/components/ui';
import { backendPost, backendPatch, backendDelete, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  NORMAL: 'bg-blue-100 text-blue-700',
  LOW: 'bg-gray-100 text-gray-500',
};

const ALERT_TYPES = [
  'DOCUMENT_EXPIRY', 'LICENSE_EXPIRY', 'CONTRACT_EXPIRY', 'LOAN_REPAYMENT_DUE', 'COMPLIANCE_DUE',
  'TAX_FILING_DUE', 'PAYROLL_PENDING', 'LOW_STOCK', 'FUEL_LOW_STOCK', 'FUEL_VARIANCE',
  'CASH_SHORTAGE', 'OVERDUE_RECEIVABLE', 'OVERDUE_PAYABLE', 'RENT_ARREARS', 'ROOM_OCCUPANCY',
  'PARKING_OVERSTAY', 'VEHICLE_LICENSE_EXPIRY', 'EMPLOYEE_CONTRACT_EXPIRY', 'CUSTOM',
];
const FREQUENCIES = ['IMMEDIATE', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'];
const RECIPIENT_TYPES = ['USER', 'ROLE', 'PERMISSION', 'MANAGER', 'GROUP_CONTROL', 'CUSTOM'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];

interface Company { id: string; name: string }

interface AlertRule {
  id: string;
  alertRuleCode: string;
  name: string;
  description?: string | null;
  alertType: string;
  companyId?: string | null;
  isActive: boolean;
  frequency?: string | null;
  recipientType?: string | null;
  recipientUserId?: string | null;
  recipientRoleId?: string | null;
  recipientPermission?: string | null;
  priority?: string | null;
  entityType?: string | null;
  daysBefore?: number | null;
}

interface RuleForm {
  name: string; description: string; alertType: string; companyId: string;
  frequency: string; recipientType: string; recipientUserId: string;
  recipientRoleId: string; recipientPermission: string; priority: string;
  entityType: string; daysBefore: string;
}
const BLANK: RuleForm = {
  name: '', description: '', alertType: 'CUSTOM', companyId: '', frequency: 'DAILY',
  recipientType: 'ROLE', recipientUserId: '', recipientRoleId: '', recipientPermission: '',
  priority: 'NORMAL', entityType: '', daysBefore: '',
};

function RuleModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: AlertRule; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<RuleForm>(() => initial ? {
    name: initial.name,
    description: initial.description ?? '',
    alertType: initial.alertType,
    companyId: initial.companyId ?? '',
    frequency: initial.frequency ?? 'DAILY',
    recipientType: initial.recipientType ?? 'ROLE',
    recipientUserId: initial.recipientUserId ?? '',
    recipientRoleId: initial.recipientRoleId ?? '',
    recipientPermission: initial.recipientPermission ?? '',
    priority: initial.priority ?? 'NORMAL',
    entityType: initial.entityType ?? '',
    daysBefore: initial.daysBefore != null ? String(initial.daysBefore) : '',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof RuleForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.alertType) { setError('Name and alert type are required'); return; }
    setSaving(true); setError('');
    try {
      const cleared = mode === 'edit' ? null : undefined;
      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description || cleared,
        alertType: form.alertType,
        companyId: form.companyId || cleared,
        frequency: form.frequency || undefined,
        recipientType: form.recipientType || undefined,
        recipientUserId: form.recipientType === 'USER' ? form.recipientUserId || cleared : cleared,
        recipientRoleId: form.recipientType === 'ROLE' ? form.recipientRoleId || cleared : cleared,
        recipientPermission: form.recipientType === 'PERMISSION' ? form.recipientPermission || cleared : cleared,
        priority: form.priority || undefined,
        entityType: form.entityType || cleared,
        daysBefore: form.daysBefore !== '' ? Number(form.daysBefore) : cleared,
      };
      if (mode === 'create') await backendPost('/alert-rules', body);
      else await backendPatch(`/alert-rules/${initial!.id}`, body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Alert Rule' : 'Edit Alert Rule'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        <FormSelect label="Alert Type" required value={form.alertType} onChange={(e) => set('alertType', e.target.value)}>
          {ALERT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Company" value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="All companies">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Priority" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </FormSelect>
        <FormSelect label="Frequency" value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
          {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
        </FormSelect>
        <FormSelect label="Recipient Type" value={form.recipientType} onChange={(e) => set('recipientType', e.target.value)}>
          {RECIPIENT_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
        </FormSelect>
        {form.recipientType === 'USER' && (
          <FormInput label="Recipient User ID" value={form.recipientUserId} onChange={(e) => set('recipientUserId', e.target.value)} />
        )}
        {form.recipientType === 'ROLE' && (
          <FormInput label="Recipient Role ID" value={form.recipientRoleId} onChange={(e) => set('recipientRoleId', e.target.value)} />
        )}
        {form.recipientType === 'PERMISSION' && (
          <FormInput label="Recipient Permission" value={form.recipientPermission} onChange={(e) => set('recipientPermission', e.target.value)} />
        )}
        <FormInput label="Entity Type" value={form.entityType} onChange={(e) => set('entityType', e.target.value)} />
        <FormInput label="Days Before" type="number" value={form.daysBefore} onChange={(e) => set('daysBefore', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function AlertRulesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('alert_rules.manage');

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [deleting, setDeleting] = useState<AlertRule | null>(null);
  const [actionLoading, setActionLoading] = useState('');

  const load = useCallback(() => {
    fetch('/api/backend/alert-rules').then(r => r.json())
      .then((res: any) => setRules(res.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canManage) return;
    fetch('/api/backend/companies?limit=100').then(r => r.json())
      .then((res: any) => setCompanies(res.data?.data ?? res.data ?? []))
      .catch(() => {});
  }, [canManage]);

  const onSaved = () => {
    setCreating(false); setEditing(null); load();
    showToast('success', 'Alert rule saved');
  };

  const toggleActive = async (rule: AlertRule) => {
    setActionLoading(rule.id);
    try {
      await backendPatch(`/alert-rules/${rule.id}/${rule.isActive ? 'deactivate' : 'activate'}`);
      showToast('success', `Alert rule ${rule.isActive ? 'deactivated' : 'activated'}`);
      load();
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Action failed');
    } finally { setActionLoading(''); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await backendDelete(`/alert-rules/${deleting.id}`);
      showToast('success', 'Alert rule deleted');
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
          <h1 className="text-2xl font-bold text-gray-900">Alert Rules</h1>
          <p className="text-gray-500 mt-1">Configure automated alert rules</p>
        </div>
        {canManage && (
          <button onClick={() => setCreating(true)} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
            + New Alert Rule
          </button>
        )}
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Code', 'Name', 'Type', 'Priority', 'Frequency', 'Active', ...(canManage ? ['Actions'] : [])].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rules.map(rule => (
                <tr key={rule.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-700">{rule.alertRuleCode}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{rule.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{rule.alertType}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[rule.priority ?? ''] || 'bg-gray-100 text-gray-500'}`}>
                      {rule.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{rule.frequency}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${rule.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-6 py-4 text-sm space-x-2 whitespace-nowrap">
                      <button onClick={() => setEditing(rule)} className="text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => toggleActive(rule)} disabled={actionLoading === rule.id} className="text-gray-500 hover:underline disabled:opacity-50">
                        {actionLoading === rule.id ? '…' : rule.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => setDeleting(rule)} className="text-red-500 hover:underline">Delete</button>
                    </td>
                  )}
                </tr>
              ))}
              {rules.length === 0 && (
                <tr><td colSpan={canManage ? 7 : 6} className="px-6 py-10 text-center text-gray-400">No alert rules found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating && <RuleModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <RuleModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Alert Rule"
        message={`Delete alert rule "${deleting?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
