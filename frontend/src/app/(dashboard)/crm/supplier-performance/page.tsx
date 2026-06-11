'use client';

import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';

export default function SupplierPerformancePage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/supplier-performance')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Supplier Performance</h1>
        <p className="text-gray-500 mt-1">Evaluate and track supplier performance metrics</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Overall Rating</th>
                <th className="px-4 py-3">On-Time Delivery %</th>
                <th className="px-4 py-3">Quality Score</th>
                <th className="px-4 py-3">Price Score</th>
                <th className="px-4 py-3">Total Purchases</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">{row.companyId}</td>
                  <td className="px-4 py-3 font-medium">{row.supplierId}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.rating >= 4 ? 'bg-green-100 text-green-700' : row.rating >= 2.5 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                      {row.rating}
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.onTimeDeliveryRate != null ? `${row.onTimeDeliveryRate}%` : '—'}</td>
                  <td className="px-4 py-3">{row.qualityScore ?? '—'}</td>
                  <td className="px-4 py-3">{row.priceCompetitivenessScore ?? '—'}</td>
                  <td className="px-4 py-3 font-medium">{row.totalPurchases}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
