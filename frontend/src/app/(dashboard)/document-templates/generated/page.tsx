'use client';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useState, useEffect, useCallback } from 'react';
import { ErrorState, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';

export default function GeneratedDocumentsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('generated_documents.list');
  const beginRequest = useRequestGuard();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/backend/generated-documents', { signal: request.signal });
      if (!request.current()) return;
      if (!response.ok) throw new Error('Failed to load generated documents.');
      const res = await response.json();
      if (!request.current()) return;
      setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      if (!request.current()) return;
      setData([]);
      setLoadError(err instanceof Error ? err.message : 'Failed to load generated documents.');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [authLoading, beginRequest, canView]);

  useEffect(() => { void load(); }, [load]);

  if (authLoading || !canView) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900">Generated Documents</h1>
        <p className="text-gray-500 mt-1">{authLoading ? 'Loading' : 'Access Restricted'}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Generated Documents</h1>
        <p className="text-gray-500 mt-1">View all documents generated from templates</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <WorkspaceTable className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Document #</th>
                <th className="px-4 py-3">Entity Type</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Generated At</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.generatedDocumentNumber}</td>
                  <td className="px-4 py-3">{row.entityType}</td>
                  <td className="px-4 py-3">{row.entityId}</td>
                  <td className="px-4 py-3 font-medium">{row.title}</td>
                  <td className="px-4 py-3">{row.outputFormat}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : row.status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{row.generatedAt ? new Date(row.generatedAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </WorkspaceTable>
        </div>
      )}
    </div>
  );
}
