'use client';
import { useState, useEffect } from 'react';

export default function PendingApprovalsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/approvals/requests/pending/me').then(r => r.json())
      .then((res: any) => setItems(Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function daysPending(createdAt: string) {
    const ms = Date.now() - new Date(createdAt).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pending Approvals</h1>
        <p className="text-gray-500 mt-1">Approval requests awaiting your action</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Request #', 'Entity Type', 'Requester', 'Amount', 'Days Pending', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-700">{item.requestNumber}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{item.entityType}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{item.requester?.fullName || item.requester?.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {item.amount ? `${item.currency || ''} ${Number(item.amount).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {item.createdAt ? (
                      <span className={`font-medium ${daysPending(item.createdAt) > 3 ? 'text-red-600' : 'text-gray-700'}`}>
                        {daysPending(item.createdAt)}d
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm space-x-2">
                    <button className="text-green-600 hover:underline font-medium">Approve</button>
                    <button className="text-red-500 hover:underline">Reject</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400">No pending approvals</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
