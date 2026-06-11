'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageSpinner } from '@/components/ui';

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-200 text-red-900',
  HIGH: 'bg-red-100 text-red-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  LOW: 'bg-blue-100 text-blue-700',
  INFO: 'bg-gray-100 text-gray-600',
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-orange-100 text-orange-700',
  ACKNOWLEDGED: 'bg-blue-100 text-blue-700',
  RESOLVED: 'bg-green-100 text-green-700',
  DISMISSED: 'bg-gray-100 text-gray-500',
};

export default function DataIsolationIssuesPage() {
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');

  const fetchIssues = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (severityFilter) params.set('severity', severityFilter);
    fetch(`/api/backend/data-isolation-issues?${params}`)
      .then(r => r.json())
      .then(res => setIssues(res.data ?? res.issues ?? res ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter, severityFilter]);

  useEffect(() => { fetchIssues(); }, [fetchIssues]);

  async function updateIssue(id: string, action: 'acknowledge' | 'resolve' | 'dismiss') {
    await fetch(`/api/backend/data-isolation-issues/${id}/${action}`, { method: 'PUT' });
    fetchIssues();
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Isolation Issues</h1>
        <p className="text-gray-500 mt-1">Data isolation violations and boundary breach reports</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex gap-3">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="">All Severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
          <option value="INFO">Info</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th className="px-4 py-3">Issue Type</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Entity Type</th>
              <th className="px-4 py-3">Endpoint</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Test Run</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-6"><PageSpinner label="Loading records" className="py-8" /></td></tr>
            ) : issues.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No issues found</td></tr>
            ) : issues.map((issue: any) => (
              <tr key={issue.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{issue.issueType ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEVERITY_COLORS[issue.severity] ?? 'bg-gray-100 text-gray-600'}`}>{issue.severity ?? '—'}</span>
                </td>
                <td className="px-4 py-3 text-gray-500">{issue.entityType ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">{issue.endpoint ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[issue.status] ?? 'bg-gray-100 text-gray-600'}`}>{issue.status ?? '—'}</span>
                </td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{issue.testRunId?.slice(0, 8) ?? '—'}</td>
                <td className="px-4 py-3 text-gray-400">{issue.createdAt ? new Date(issue.createdAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => updateIssue(issue.id, 'acknowledge')} className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100">Ack</button>
                    <button onClick={() => updateIssue(issue.id, 'resolve')} className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100">Resolve</button>
                    <button onClick={() => updateIssue(issue.id, 'dismiss')} className="px-2 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100">Dismiss</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
