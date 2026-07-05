'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageSpinner, PageToolbar, Modal, Btn, ConfirmDialog, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useOrgScope } from '@/hooks/use-org-scope';
import { backendPost, backendPut, ApiError } from '@/lib/api-client';

interface CommunicationLog {
  id: string;
  communicationNumber: string;
  companyId: string;
  entityType: string;
  entityId: string;
  communicationType: string;
  direction: string;
  subject?: string | null;
  summary: string;
  communicationDate?: string | null;
  followUpRequired: boolean;
  followUpDate?: string | null;
  assignedToId?: string | null;
  status: string;
}

const ENTITY_TYPES = ['CUSTOMER', 'SUPPLIER', 'TENANT', 'GUEST', 'PARTNER', 'OTHER'];
const COMMUNICATION_TYPES = ['PHONE_CALL', 'EMAIL', 'SMS', 'WHATSAPP', 'MEETING', 'VISIT', 'NOTE', 'OTHER'];
const DIRECTIONS = ['INBOUND', 'OUTBOUND', 'INTERNAL'];
const STATUSES = ['OPEN', 'FOLLOWED_UP', 'CLOSED', 'CANCELLED'];

interface LogForm {
  companyId: string; entityType: string; entityId: string; communicationType: string;
  direction: string; subject: string; summary: string; communicationDate: string;
  followUpRequired: string; followUpDate: string; assignedToId: string; status: string;
}

const BLANK: LogForm = {
  companyId: '', entityType: '', entityId: '', communicationType: '',
  direction: '', subject: '', summary: '', communicationDate: '',
  followUpRequired: 'false', followUpDate: '', assignedToId: '', status: 'OPEN',
};

function LogModal({ mode, initial, companyOptions, onClose, onSaved }: {
  mode: 'create' | 'edit';
  initial?: CommunicationLog;
  companyOptions: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<LogForm>(() => initial ? {
    companyId: initial.companyId,
    entityType: initial.entityType,
    entityId: initial.entityId,
    communicationType: initial.communicationType,
    direction: initial.direction ?? '',
    subject: initial.subject ?? '',
    summary: initial.summary,
    communicationDate: initial.communicationDate?.split('T')[0] ?? '',
    followUpRequired: initial.followUpRequired ? 'true' : 'false',
    followUpDate: initial.followUpDate?.split('T')[0] ?? '',
    assignedToId: initial.assignedToId ?? '',
    status: initial.status,
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof LogForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (mode === 'create' && (!form.companyId || !form.entityType || !form.entityId || !form.communicationType)) {
      setError('Company, entity type, entity ID and type are required');
      return;
    }
    if (!form.summary.trim()) { setError('Summary is required'); return; }
    setSaving(true); setError('');
    try {
      const cleared = mode === 'edit' ? null : undefined;
      const shared = {
        communicationType: form.communicationType,
        direction: form.direction || undefined,
        subject: form.subject || cleared,
        summary: form.summary,
        communicationDate: form.communicationDate || undefined,
        followUpRequired: form.followUpRequired === 'true',
        followUpDate: form.followUpDate || cleared,
        assignedToId: form.assignedToId || cleared,
      };
      if (mode === 'create') {
        await backendPost('/communication-logs', {
          companyId: form.companyId,
          entityType: form.entityType,
          entityId: form.entityId,
          ...shared,
        });
      } else {
        await backendPut(`/communication-logs/${initial!.id}`, { ...shared, status: form.status });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Communication Log' : `Edit ${initial?.communicationNumber ?? 'Communication Log'}`} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        {mode === 'create' && (
          <>
            <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} options={companyOptions} placeholder="Select…" />
            <FormSelect label="Entity Type" required value={form.entityType} onChange={(e) => set('entityType', e.target.value)} placeholder="Select…">
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </FormSelect>
            <FormInput label="Entity ID" required value={form.entityId} onChange={(e) => set('entityId', e.target.value)} hint="Customer / supplier record ID" />
          </>
        )}
        <FormSelect label="Type" required value={form.communicationType} onChange={(e) => set('communicationType', e.target.value)} placeholder="Select…">
          {COMMUNICATION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormSelect label="Direction" value={form.direction} onChange={(e) => set('direction', e.target.value)} placeholder="Default (Outbound)">
          {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </FormSelect>
        <FormInput label="Subject" value={form.subject} onChange={(e) => set('subject', e.target.value)} />
        <FormInput label="Communication Date" type="date" value={form.communicationDate} onChange={(e) => set('communicationDate', e.target.value)} />
        <div className="col-span-2">
          <FormTextarea label="Summary" required rows={3} value={form.summary} onChange={(e) => set('summary', e.target.value)} />
        </div>
        <FormSelect label="Follow-up Required" value={form.followUpRequired} onChange={(e) => set('followUpRequired', e.target.value)}
          options={[{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }]} />
        <FormInput label="Follow-up Date" type="date" value={form.followUpDate} onChange={(e) => set('followUpDate', e.target.value)} />
        <FormInput label="Assigned To (User ID)" value={form.assignedToId} onChange={(e) => set('assignedToId', e.target.value)} />
        {mode === 'edit' && (
          <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </FormSelect>
        )}
      </div>
    </Modal>
  );
}

export default function CommunicationLogsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('communication_logs.create');
  const canUpdate = hasPermission('communication_logs.update');

  const [data, setData] = useState<CommunicationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CommunicationLog | null>(null);
  const [closing, setClosing] = useState<CommunicationLog | null>(null);
  const [closeLoading, setCloseLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const { companyOptions } = useOrgScope(undefined, { skipBranches: true, skipDivisions: true, skipEmployees: true });

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/communication-logs')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSaved = () => { setCreating(false); setEditing(null); load(); };

  const doClose = async () => {
    if (!closing) return;
    setCloseLoading(true); setActionError('');
    try {
      await backendPost(`/communication-logs/${closing.id}/close`);
      setClosing(null);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Close failed');
      setClosing(null);
    } finally {
      setCloseLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Communication Logs</h1>
        <p className="text-gray-500 mt-1">Track all customer and supplier communications</p>
      </div>

      {canCreate && (
        <PageToolbar actions={<Btn variant="primary" onClick={() => setCreating(true)}>+ New Log</Btn>} />
      )}

      {actionError && (
        <div className="mb-4 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>
      )}

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Communication #</th>
                <th className="px-4 py-3">Entity Type</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
                {canUpdate && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={canUpdate ? 9 : 8} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.communicationNumber}</td>
                  <td className="px-4 py-3">{row.entityType}</td>
                  <td className="px-4 py-3">{row.entityId}</td>
                  <td className="px-4 py-3">{row.communicationType}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.direction === 'INBOUND' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                      {row.direction}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[200px] truncate">{row.subject ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'RESOLVED' ? 'bg-green-100 text-green-700' : row.status === 'OPEN' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{row.communicationDate ? new Date(row.communicationDate).toLocaleDateString() : '—'}</td>
                  {canUpdate && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Btn variant="ghost" size="xs" onClick={() => setEditing(row)}>Edit</Btn>
                      {row.status !== 'CLOSED' && (
                        <Btn variant="ghost" size="xs" onClick={() => setClosing(row)}>Close</Btn>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <LogModal mode="create" companyOptions={companyOptions} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <LogModal mode="edit" initial={editing} companyOptions={companyOptions} onClose={() => setEditing(null)} onSaved={onSaved} />}
      <ConfirmDialog
        open={!!closing}
        title="Close Communication Log"
        message={`Close ${closing?.communicationNumber ?? 'this log'}? Closed logs are considered resolved.`}
        confirmLabel="Close Log"
        variant="warning"
        loading={closeLoading}
        onConfirm={doClose}
        onCancel={() => setClosing(null)}
      />
    </div>
  );
}
