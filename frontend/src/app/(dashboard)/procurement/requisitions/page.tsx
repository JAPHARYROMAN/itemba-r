'use client';

import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';

export default function PurchaseRequisitionsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/purchase-requisitions')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Requisitions</h1>
        <p className="text-gray-500 mt-1">Manage internal purchase requests</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Requisition #</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Requested By</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Estimated Amount</th>
                <th className="px-4 py-3">Request Date</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.requisitionNumber}</td>
                  <td className="px-4 py-3">{row.companyId}</td>
                  <td className="px-4 py-3">{row.requestedById}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.priority === 'HIGH' || row.priority === 'URGENT' ? 'bg-red-100 text-red-700' : row.priority === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
                      {row.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'APPROVED' ? 'bg-green-100 text-green-700' : row.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' : row.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.totalEstimatedAmount}</td>
                  <td className="px-4 py-3 text-gray-400">{row.requestDate ? new Date(row.requestDate).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
