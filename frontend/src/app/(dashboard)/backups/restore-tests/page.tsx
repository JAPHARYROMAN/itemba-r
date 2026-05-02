'use client';

import { useState, useEffect } from 'react';
import { backendList } from '@/lib/api-client';

const STATUS_COLORS: Record<string, string> = {
  PASSED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  PLANNED: 'bg-yellow-100 text-yellow-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

export default function RestoreTestsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    backendList<any>('/restore-tests')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Restore Tests</h1>
        <p className="text-gray-500 mt-1">Verify backup restore procedures</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Test #</th>
                <th className="px-4 py-3">Test Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tested By</th>
                <th className="px-4 py-3">Result Summary</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No restore tests found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.restoreTestNumber}</td>
                  <td className="px-4 py-3 text-gray-500">{row.testDate ? new Date(row.testDate).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">{row.testType ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-3">{row.testedById ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[300px] truncate">{row.resultSummary ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
