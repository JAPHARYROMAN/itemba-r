'use client';

import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';

export default function DocumentTemplatesPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/document-templates')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Document Templates</h1>
        <p className="text-gray-500 mt-1">Manage document and report templates</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Template Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Template Type</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Default</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.templateCode}</td>
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3">{row.templateType}</td>
                  <td className="px-4 py-3">{row.format}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.isDefault ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                      {row.isDefault ? 'Default' : 'Custom'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
