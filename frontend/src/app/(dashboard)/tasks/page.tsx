'use client';
import { useState, useEffect } from 'react';

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  NORMAL: 'bg-blue-100 text-blue-700',
  LOW: 'bg-gray-100 text-gray-500',
};

const STATUS_COLORS: Record<string, string> = {
  TODO: 'bg-gray-100 text-gray-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  DONE: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-500',
  BLOCKED: 'bg-yellow-100 text-yellow-700',
};

type Tab = 'my' | 'all';

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('my');

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = activeTab === 'my' ? { assignedToMe: 'true' } : {};
    const qs = new URLSearchParams(params).toString();
    fetch(`/api/backend/tasks${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then((res: any) => setTasks(res.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeTab]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'my', label: 'My Tasks' },
    { key: 'all', label: 'All Tasks' },
  ];

  function dueDateClass(dueDate: string | null) {
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
        <button className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
          + New Task
        </button>
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

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
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
              {tasks.map(task => (
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
                  <td className="px-6 py-4 text-sm space-x-2">
                    {task.status !== 'DONE' && task.status !== 'CANCELLED' && (
                      <button className="text-green-600 hover:underline">Complete</button>
                    )}
                    {task.status !== 'CANCELLED' && task.status !== 'DONE' && (
                      <button className="text-red-500 hover:underline">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400">No tasks found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
