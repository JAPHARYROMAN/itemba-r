'use client';

import { useState, useEffect } from 'react';

export default function AccountingLocksPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/accounting-locks')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Accounting Locks</h1>
        <p className="text-gray-500 mt-1">Manage accounting period and entity locks</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Lock Code</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Lock Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Locked From</th>
                <th className="px-4 py-3">Locked To</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.lockCode}</td>
                  <td className="px-4 py-3">{row.companyId}</td>
                  <td className="px-4 py-3">{row.lockType}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'ACTIVE' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.lockedFrom ? new Date(row.lockedFrom).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{row.lockedTo ? new Date(row.lockedTo).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
