'use client';

import { useState, useEffect } from 'react';

export default function ThreeWayMatchingPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/three-way-matching')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Three-Way Matching</h1>
        <p className="text-gray-500 mt-1">Match purchase orders, goods received notes, and supplier invoices</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Match #</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Purchase Order</th>
                <th className="px-4 py-3">Match Status</th>
                <th className="px-4 py-3">Qty Variance</th>
                <th className="px-4 py-3">Amount Variance</th>
                <th className="px-4 py-3">Match Date</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.matchNumber}</td>
                  <td className="px-4 py-3">{row.companyId}</td>
                  <td className="px-4 py-3">{row.purchaseOrderId}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.matchStatus === 'MATCHED' ? 'bg-green-100 text-green-700' : row.matchStatus === 'EXCEPTION' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {row.matchStatus}
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-medium ${row.quantityVariance !== 0 ? 'text-red-600' : 'text-green-600'}`}>{row.quantityVariance ?? '—'}</td>
                  <td className={`px-4 py-3 font-medium ${row.amountVariance !== 0 ? 'text-red-600' : 'text-green-600'}`}>{row.amountVariance ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{row.matchDate ? new Date(row.matchDate).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
