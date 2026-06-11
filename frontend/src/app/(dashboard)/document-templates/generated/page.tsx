'use client';

import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';

export default function GeneratedDocumentsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/generated-documents')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Generated Documents</h1>
        <p className="text-gray-500 mt-1">View all documents generated from templates</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
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
          </table>
        </div>
      )}
    </div>
  );
}
