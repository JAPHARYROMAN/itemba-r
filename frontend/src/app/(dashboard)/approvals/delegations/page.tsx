'use client';
import { useCallback, useEffect, useState } from 'react';
import { PageSpinner, Modal, Btn, ConfirmDialog, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendList, backendPost, backendPatch, backendDelete, ApiError } from '@/lib/api-client';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
  CANCELLED: 'bg-red-100 text-red-600',
  INACTIVE: 'bg-yellow-100 text-yellow-700',
};

interface UserRef { id: string; fullName?: string | null; email?: string | null }
interface CompanyRef { id: string; name: string }

interface Delegation {
  id: string;
  delegatorUserId: string;
  delegateUserId: string;
  companyId?: string | null;
  entityType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  reason?: string | null;
  status: string;
  delegator?: UserRef | null;
  delegate?: UserRef | null;
}

interface DelegationForm {
  delegatorUserId: string; delegateUserId: string; companyId: string;
  entityType: string; startDate: string; endDate: string; reason: string;
}
const BLANK: DelegationForm = { delegatorUserId: '', delegateUserId: '', companyId: '', entityType: '', startDate: '', endDate: '', reason: '' };

const userLabel = (u?: UserRef | null) => u?.fullName || u?.email || '—';

function DelegationModal({ mode, initial, users, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: Delegation; users: UserRef[]; companies: CompanyRef[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<DelegationForm>(() => initial ? {
    delegatorUserId: initial.delegatorUserId,
    delegateUserId: initial.delegateUserId,
    companyId: initial.companyId ?? '',
    entityType: initial.entityType ?? '',
    startDate: initial.startDate?.split('T')[0] ?? '',
    endDate: initial.endDate?.split('T')[0] ?? '',
    reason: initial.reason ?? '',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof DelegationForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.delegatorUserId || !form.delegateUserId) { setError('Delegator and delegate are required'); return; }
    if (!form.startDate || !form.endDate) { setError('Start and end dates are required'); return; }
    setSaving(true); setError('');
    try {
      const cleared = mode === 'edit' ? null : undefined;
      const body = {
        delegatorUserId: form.delegatorUserId,
        delegateUserId: form.delegateUserId,
        companyId: form.companyId || cleared,
        entityType: form.entityType || cleared,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason || cleared,
      };
      if (mode === 'create') await backendPost('/approvals/delegations', body);
      else await backendPatch(`/approvals/delegations/${initial!.id}`, body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Delegation' : 'Edit Delegation'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect label="Delegator" required value={form.delegatorUserId} onChange={(e) => set('delegatorUserId', e.target.value)} placeholder="Select…">
          {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
        </FormSelect>
        <FormSelect label="Delegate" required value={form.delegateUserId} onChange={(e) => set('delegateUserId', e.target.value)} placeholder="Select…">
          {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
        </FormSelect>
        <FormSelect label="Company" value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="All companies">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormInput label="Entity Type" value={form.entityType} onChange={(e) => set('entityType', e.target.value)} hint="Leave blank to cover all entity types" />
        <FormInput label="Start Date" type="date" required value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        <FormInput label="End Date" type="date" required value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Reason" rows={2} value={form.reason} onChange={(e) => set('reason', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function DelegationsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('approval_delegations.manage');

  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [companies, setCompanies] = useState<CompanyRef[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Delegation | null>(null);
  const [cancelling, setCancelling] = useState<Delegation | null>(null);
  const [deleting, setDeleting] = useState<Delegation | null>(null);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    setLoadError('');
    fetch('/api/backend/approvals/delegations').then(r => r.json())
      .then((res: { data?: { data?: Delegation[] } }) => setDelegations(res.data?.data ?? []))
      .catch(() => {
        setDelegations([]);
        setLoadError('Failed to load delegations. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canManage) return;
    backendList<UserRef>('/users', { query: { limit: 1000 } }).then(setUsers).catch(() => setUsers([]));
    backendList<CompanyRef>('/companies', { query: { limit: 100 } }).then(setCompanies).catch(() => setCompanies([]));
  }, [canManage]);

  const onSaved = () => { setCreating(false); setEditing(null); load(); };

  const doCancel = async () => {
    if (!cancelling) return;
    setActionError('');
    try {
      await backendPatch(`/approvals/delegations/${cancelling.id}/cancel`);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Cancel failed');
    } finally { setCancelling(null); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setActionError('');
    try {
      await backendDelete(`/approvals/delegations/${deleting.id}`);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally { setDeleting(null); }
  };

  const ACTIONS: Record<string, { label: string; cls: string; onClick: (d: Delegation) => void }[]> = {
    ACTIVE: [
      { label: 'Edit', cls: 'text-brand-600 hover:underline', onClick: (d) => setEditing(d) },
      { label: 'Cancel', cls: 'text-red-500 hover:underline', onClick: (d) => setCancelling(d) },
      { label: 'Delete', cls: 'text-red-400 hover:underline', onClick: (d) => setDeleting(d) },
    ],
    INACTIVE: [
      { label: 'Edit', cls: 'text-brand-600 hover:underline', onClick: (d) => setEditing(d) },
      { label: 'Delete', cls: 'text-red-400 hover:underline', onClick: (d) => setDeleting(d) },
    ],
    EXPIRED: [
      { label: 'Delete', cls: 'text-red-400 hover:underline', onClick: (d) => setDeleting(d) },
    ],
    CANCELLED: [
      { label: 'Delete', cls: 'text-red-400 hover:underline', onClick: (d) => setDeleting(d) },
    ],
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval Delegations</h1>
          <p className="text-gray-500 mt-1">Manage approval authority delegations</p>
        </div>
        {canManage && (
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            + New Delegation
          </button>
        )}
      </div>

      {loadError && (
        <div className="mb-4 flex items-center justify-between text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span>{loadError}</span>
          <button onClick={load} className="text-red-700 font-medium hover:underline ml-3">Retry</button>
        </div>
      )}

      {actionError && (
        <div className="mb-4 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>
      )}

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Delegator', 'Delegate', 'Entity Type', 'Start Date', 'End Date', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {delegations.map(d => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900">{userLabel(d.delegator)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{userLabel(d.delegate)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{d.entityType || 'All'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{d.startDate ? new Date(d.startDate).toLocaleDateString() : '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{d.endDate ? new Date(d.endDate).toLocaleDateString() : '—'}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[d.status] || 'bg-gray-100 text-gray-500'}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm space-x-2">
                    {canManage && (ACTIONS[d.status] ?? []).map(a => (
                      <button key={a.label} className={a.cls} onClick={() => a.onClick(d)}>{a.label}</button>
                    ))}
                  </td>
                </tr>
              ))}
              {delegations.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">No delegations found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating && <DelegationModal mode="create" users={users} companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <DelegationModal mode="edit" initial={editing} users={users} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      <ConfirmDialog
        open={!!cancelling}
        title="Cancel Delegation"
        message={`Cancel the delegation from ${userLabel(cancelling?.delegator)} to ${userLabel(cancelling?.delegate)}? It will stop applying immediately.`}
        confirmLabel="Cancel Delegation"
        cancelLabel="Keep"
        variant="warning"
        onConfirm={doCancel}
        onCancel={() => setCancelling(null)}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete Delegation"
        message={`Delete the delegation from ${userLabel(deleting?.delegator)} to ${userLabel(deleting?.delegate)}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
