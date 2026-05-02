'use client';
import { useState, useEffect } from 'react';

export default function ApprovalWorkflowsPage() {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntityType, setFilterEntityType] = useState('');
  const [filterActive, setFilterActive] = useState('');

  useEffect(() => {
    const params: Record<string, string> = {};
    if (filterEntityType) params.entityType = filterEntityType;
    if (filterActive !== '') params.isActive = filterActive;
    const qs = new URLSearchParams(params).toString();
    fetch(`/api/backend/approvals/workflows${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then((res: any) => setWorkflows(res.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterEntityType, filterActive]);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval Workflows</h1>
          <p className="text-gray-500 mt-1">Define and manage approval workflow rules</p>
        </div>
        <button className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
          + New Workflow
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Filter by entity type..."
          value={filterEntityType}
          onChange={e => setFilterEntityType(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={filterActive}
          onChange={e => setFilterActive(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Code', 'Name', 'Entity Type', 'Scope', 'Trigger', 'Priority', 'Active', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {workflows.map(wf => (
                <tr key={wf.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-700">{wf.workflowCode}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{wf.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{wf.entityType}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{wf.workflowScope}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{wf.triggerAction}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{wf.priority}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${wf.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {wf.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm space-x-2">
                    <button className="text-blue-600 hover:underline">Edit</button>
                    <button className="text-gray-500 hover:underline">{wf.isActive ? 'Deactivate' : 'Activate'}</button>
                    <button className="text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
              {workflows.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400">No workflows found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
