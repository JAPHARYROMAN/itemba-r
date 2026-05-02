'use client';

import { useState, useEffect } from 'react';

export default function BankReconciliationsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/bank-reconciliations')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Bank Reconciliations</h1>
        <p className="text-gray-500 mt-1">Reconcile bank statements with accounting records</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Reconciliation #</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Cash Account</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Statement Start</th>
                <th className="px-4 py-3">Statement End</th>
                <th className="px-4 py-3">Difference</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.reconciliationNumber}</td>
                  <td className="px-4 py-3">{row.companyId}</td>
                  <td className="px-4 py-3">{row.cashAccountId}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'RECONCILED' ? 'bg-green-100 text-green-700' : row.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.statementStartDate ? new Date(row.statementStartDate).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{row.statementEndDate ? new Date(row.statementEndDate).toLocaleDateString() : '—'}</td>
                  <td className={`px-4 py-3 font-medium ${row.differenceAmount !== 0 ? 'text-red-600' : 'text-green-600'}`}>{row.differenceAmount ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
