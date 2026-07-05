'use client';
import { useState, useEffect, useCallback } from 'react';
import { PageSpinner, Modal, Btn, ConfirmDialog, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { backendPost, backendPatch, backendDelete } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  NORMAL: 'bg-blue-100 text-blue-700',
  LOW: 'bg-gray-100 text-gray-500',
};

const STATUS_COLORS: Record<string, string> = {
  TODO: 'bg-gray-100 text-gray-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-500',
  OVERDUE: 'bg-yellow-100 text-yellow-700',
};

const TASK_TYPES = [
  'APPROVAL_FOLLOWUP', 'COMPLIANCE_TASK', 'DOCUMENT_TASK', 'FINANCE_TASK',
  'HR_TASK', 'OPERATIONS_TASK', 'MAINTENANCE_TASK', 'CUSTOM',
];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
const OPEN_STATUSES = ['TODO', 'IN_PROGRESS', 'OVERDUE'];

interface UserRef { id: string; fullName?: string | null; email?: string | null }
interface Company { id: string; name: string }

interface Task {
  id: string;
  taskNumber: string;
  title: string;
  description?: string | null;
  taskType: string;
  priority: string;
  status: string;
  assignedToId?: string | null;
  assignedTo?: UserRef | null;
  companyId?: string | null;
  dueDate?: string | null;
}

type Tab = 'my' | 'all';

interface TaskForm {
  title: string; description: string; taskType: string; priority: string;
  assignedToId: string; companyId: string; dueDate: string;
}
const BLANK: TaskForm = { title: '', description: '', taskType: 'CUSTOM', priority: 'NORMAL', assignedToId: '', companyId: '', dueDate: '' };

function TaskModal({ mode, initial, users, companies, onClose, onSaved }: {
  mode: 'create' | 'edit'; initial?: Task; users: UserRef[]; companies: Company[];
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<TaskForm>(() => initial ? {
    title: initial.title,
    description: initial.description ?? '',
    taskType: initial.taskType,
    priority: initial.priority,
    assignedToId: initial.assignedToId ?? '',
    companyId: initial.companyId ?? '',
    dueDate: initial.dueDate?.split('T')[0] ?? '',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof TaskForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError('');
    try {
      const cleared = mode === 'edit' ? null : undefined;
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description || cleared,
        taskType: form.taskType,
        priority: form.priority,
        assignedToId: form.assignedToId || cleared,
        dueDate: form.dueDate || cleared,
      };
      if (mode === 'create') {
        body.companyId = form.companyId || undefined;
        await backendPost('/tasks', body);
      } else {
        await backendPatch(`/tasks/${initial!.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Task' : 'Edit Task'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <FormInput label="Title" required value={form.title} onChange={set('title')} />
        </div>
        <div className="col-span-2">
          <FormTextarea label="Description" rows={2} value={form.description} onChange={set('description')} />
        </div>
        <FormSelect label="Type" value={form.taskType} onChange={set('taskType')}
          options={TASK_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} />
        <FormSelect label="Priority" value={form.priority} onChange={set('priority')}
          options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
        <FormSelect label="Assigned To" value={form.assignedToId} onChange={set('assignedToId')} placeholder="Unassigned"
          options={users.map((u) => ({ value: u.id, label: u.fullName || u.email || u.id }))} />
        {mode === 'create' ? (
          <FormSelect label="Company" value={form.companyId} onChange={set('companyId')} placeholder="No company"
            options={companies.map((c) => ({ value: c.id, label: c.name }))} />
        ) : (
          <div />
        )}
        <FormInput label="Due Date" type="date" value={form.dueDate} onChange={set('dueDate')} />
      </div>
    </Modal>
  );
}

export default function TasksPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('tasks.create');
  const canUpdate = hasPermission('tasks.update');
  const canComplete = hasPermission('tasks.complete');
  const canCancel = hasPermission('tasks.cancel');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('my');
  const [users, setUsers] = useState<UserRef[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [confirming, setConfirming] = useState<{ task: Task; action: 'cancel' | 'delete' } | null>(null);
  const [actionLoading, setActionLoading] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = activeTab === 'my' ? { assignedToMe: 'true' } : {};
    const qs = new URLSearchParams(params).toString();
    fetch(`/api/backend/tasks${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then((res: any) => setTasks(res.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canCreate && !canUpdate) return;
    if (hasPermission('users.read')) {
      fetch('/api/backend/users?limit=100')
        .then((r) => r.json())
        .then((j) => setUsers(j.data?.data ?? j.data ?? []))
        .catch(() => setUsers([]));
    }
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(j.data?.data ?? j.data ?? []))
      .catch(() => setCompanies([]));
  }, [canCreate, canUpdate, hasPermission]);

  const onSaved = () => { setCreating(false); setEditing(null); load(); };

  const runAction = async (id: string, action: 'complete' | 'cancel' | 'delete') => {
    setActionLoading(`${id}-${action}`); setActionError('');
    try {
      if (action === 'delete') await backendDelete(`/tasks/${id}`);
      else await backendPatch(`/tasks/${id}/${action}`);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading('');
      setConfirming(null);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'my', label: 'My Tasks' },
    { key: 'all', label: 'All Tasks' },
  ];

  function dueDateClass(dueDate: string | null | undefined) {
    if (!dueDate) return 'text-gray-400';
    const d = new Date(dueDate);
    if (d < new Date()) return 'text-red-600 font-medium';
    const diffDays = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (diffDays < 3) return 'text-orange-500 font-medium';
    return 'text-gray-500';
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
          <p className="text-gray-500 mt-1">Manage and track operational tasks</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            + New Task
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t.key
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="mb-4 flex items-center justify-between text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span>{actionError}</span>
          <button onClick={() => setActionError('')} className="text-red-400 hover:text-red-600 ml-3">Dismiss</button>
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Task #', 'Title', 'Type', 'Priority', 'Status', 'Assigned To', 'Due Date', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tasks.map(task => {
                const open = OPEN_STATUSES.includes(task.status);
                return (
                  <tr key={task.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-mono text-gray-700">{task.taskNumber}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 max-w-xs truncate">{task.title}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{task.taskType}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[task.priority] || 'bg-gray-100 text-gray-500'}`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-500'}`}>
                        {task.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{task.assignedTo?.fullName || task.assignedTo?.email || '—'}</td>
                    <td className={`px-6 py-4 text-sm ${dueDateClass(task.dueDate)}`}>
                      {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm space-x-2 whitespace-nowrap">
                      {canUpdate && (
                        <button className="text-brand-600 hover:underline" onClick={() => setEditing(task)}>Edit</button>
                      )}
                      {canComplete && open && (
                        <button
                          className="text-green-600 hover:underline disabled:opacity-50"
                          disabled={actionLoading === `${task.id}-complete`}
                          onClick={() => runAction(task.id, 'complete')}
                        >
                          {actionLoading === `${task.id}-complete` ? '…' : 'Complete'}
                        </button>
                      )}
                      {canCancel && open && (
                        <button className="text-red-500 hover:underline" onClick={() => setConfirming({ task, action: 'cancel' })}>Cancel</button>
                      )}
                      {canUpdate && (
                        <button className="text-red-600 hover:underline" onClick={() => setConfirming({ task, action: 'delete' })}>Delete</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {tasks.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400">No tasks found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating && <TaskModal mode="create" users={users} companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <TaskModal mode="edit" initial={editing} users={users} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {confirming && (
        <ConfirmDialog
          open
          title={confirming.action === 'delete' ? 'Delete Task' : 'Cancel Task'}
          message={
            confirming.action === 'delete'
              ? `Delete task ${confirming.task.taskNumber} — "${confirming.task.title}"? This cannot be undone.`
              : `Cancel task ${confirming.task.taskNumber} — "${confirming.task.title}"?`
          }
          confirmLabel={confirming.action === 'delete' ? 'Delete' : 'Cancel Task'}
          cancelLabel="Keep Task"
          variant={confirming.action === 'delete' ? 'danger' : 'warning'}
          loading={actionLoading === `${confirming.task.id}-${confirming.action}`}
          onConfirm={() => runAction(confirming.task.id, confirming.action)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
