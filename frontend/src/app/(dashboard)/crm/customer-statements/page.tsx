'use client';

import { useState, useEffect } from 'react';

export default function CustomerStatementsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/customer-statements')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customer Statements</h1>
        <p className="text-gray-500 mt-1">View customer account statements by period</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Run #</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Period Start</th>
                <th className="px-4 py-3">Period End</th>
                <th className="px-4 py-3">Opening Balance</th>
                <th className="px-4 py-3">Closing Balance</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.statementRunNumber}</td>
                  <td className="px-4 py-3">{row.companyId}</td>
                  <td className="px-4 py-3 font-medium">{row.customerId}</td>
                  <td className="px-4 py-3 text-gray-400">{row.periodStart ? new Date(row.periodStart).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{row.periodEnd ? new Date(row.periodEnd).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">{row.openingBalance}</td>
                  <td className="px-4 py-3 font-medium">{row.closingBalance}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'SENT' ? 'bg-green-100 text-green-700' : row.status === 'DRAFT' ? 'bg-gray-100 text-gray-600' : 'bg-yellow-100 text-yellow-700'}`}>
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
