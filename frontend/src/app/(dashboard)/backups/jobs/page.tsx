'use client';

import { useCallback, useEffect, useState } from 'react';
import { Btn, ConfirmDialog, ErrorState, FormInput, FormSelect, Modal, PageSpinner, showToast } from '@/components/ui';
import { ApiError, backendDelete, backendList, backendPatch, backendPost } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-gray-100 text-gray-500',
  PAUSED: 'bg-yellow-100 text-yellow-700',
};

const BACKUP_TYPES = ['DATABASE', 'FILE_STORAGE', 'DOCUMENTS', 'FULL_SYSTEM', 'CONFIGURATION', 'AUDIT_LOGS', 'CUSTOM'];
const SCHEDULES = ['MANUAL', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'];
const STORAGE_TARGETS = ['LOCAL', 'S3_COMPATIBLE', 'CLOUD_STORAGE', 'EXTERNAL_DRIVE', 'CUSTOM'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'PAUSED'];

interface BackupJob {
  id: string;
  backupJobCode: string;
  name: string;
  backupType: string;
  schedule?: string | null;
  storageTarget?: string | null;
  retentionDays?: number | null;
  status: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

interface JobForm {
  name: string;
  backupType: string;
  schedule: string;
  storageTarget: string;
  retentionDays: string;
  status: string;
}

const BLANK: JobForm = { name: '', backupType: 'DATABASE', schedule: 'MANUAL', storageTarget: '', retentionDays: '30', status: 'ACTIVE' };

function JobModal({ mode, initial, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: BackupJob; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<JobForm>(() => initial ? {
    name: initial.name,
    backupType: initial.backupType,
    schedule: initial.schedule ?? '',
    storageTarget: initial.storageTarget ?? '',
    retentionDays: initial.retentionDays != null ? String(initial.retentionDays) : '',
    status: initial.status,
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof JobForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        schedule: form.schedule || undefined,
        storageTarget: form.storageTarget || undefined,
        retentionDays: form.retentionDays ? Number(form.retentionDays) : undefined,
        status: form.status || undefined,
      };
      if (mode === 'create') {
        body.backupType = form.backupType;
        await backendPost('/backup-jobs', body);
      } else {
        await backendPatch(`/backup-jobs/${initial!.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Backup Job' : 'Edit Backup Job'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
        <FormSelect label="Backup Type" required value={form.backupType} onChange={(e) => set('backupType', e.target.value)} disabled={mode === 'edit'}
          hint={mode === 'edit' ? 'Type cannot be changed after creation' : undefined}>
          {BACKUP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Schedule" value={form.schedule} onChange={(e) => set('schedule', e.target.value)} placeholder="Select…">
          {SCHEDULES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <FormSelect label="Storage Target" value={form.storageTarget} onChange={(e) => set('storageTarget', e.target.value)} placeholder="Select…">
          {STORAGE_TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormInput label="Retention (days)" type="number" min={1} value={form.retentionDays} onChange={(e) => set('retentionDays', e.target.value)} />
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
      </div>
    </Modal>
  );
}

export default function BackupJobsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('backup_jobs.manage');

  const [data, setData] = useState<BackupJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BackupJob | null>(null);
  const [deleting, setDeleting] = useState<BackupJob | null>(null);

  const load = useCallback(() => {
    setLoadError('');
    backendList<BackupJob>('/backup-jobs')
      .then(setData)
      .catch(() => { setData([]); setLoadError('Failed to load backup jobs.'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    try {
      await backendDelete(`/backup-jobs/${deleting.id}`);
      setDeleting(null);
      load();
    } catch (err) {
      showToast('error', 'Delete failed', err instanceof ApiError ? err.message : 'Could not delete backup job');
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Backup Jobs</h1>
          <p className="text-gray-500 mt-1">Configure and manage scheduled backup jobs</p>
        </div>
        {canManage && <Btn variant="primary" onClick={() => setCreating(true)}>+ New Backup Job</Btn>}
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Storage Target</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Run</th>
                <th className="px-4 py-3">Next Run</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-8 text-center text-gray-400">No backup jobs found</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.backupJobCode}</td>
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3">{row.backupType}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.schedule ?? '—'}</td>
                  <td className="px-4 py-3">{row.storageTarget ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{row.lastRunAt ? new Date(row.lastRunAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{row.nextRunAt ? new Date(row.nextRunAt).toLocaleString() : '—'}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Btn variant="ghost" size="xs" onClick={() => setEditing(row)}>Edit</Btn>
                      <Btn variant="ghost" size="xs" onClick={() => setDeleting(row)}>Delete</Btn>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <JobModal mode="create" onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <JobModal mode="edit" initial={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Backup Job"
        message={deleting ? `Delete backup job "${deleting.name}" (${deleting.backupJobCode})? Scheduled runs for this job will stop.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
