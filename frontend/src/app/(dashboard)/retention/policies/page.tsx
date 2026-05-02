'use client';

import { useState, useEffect } from 'react';
import { backendList } from '@/lib/api-client';

export default function RetentionPoliciesPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    backendList<any>('retention-policies')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Retention Policies</h1>
        <p className="text-gray-500 mt-1">Configure data retention rules and schedules</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Retention Days</th>
                <th className="px-4 py-3">Archive After</th>
                <th className="px-4 py-3">Deletion Allowed</th>
                <th className="px-4 py-3">Legal Hold</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    No retention policies found
                  </td>
                </tr>
              ) : (
                data.map((row: any) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{row.retentionPolicyCode}</td>
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3">{row.dataCategory ?? '—'}</td>
                    <td className="px-4 py-3">{row.retentionDays ?? '—'}</td>
                    <td className="px-4 py-3">
                      {row.archiveAfterDays != null ? `${row.archiveAfterDays}d` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${row.deletionAllowed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
                      >
                        {row.deletionAllowed ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${row.legalHold ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {row.legalHold ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
