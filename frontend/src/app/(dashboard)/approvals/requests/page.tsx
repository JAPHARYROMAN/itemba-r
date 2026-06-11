'use client';
import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  ESCALATED: 'bg-purple-100 text-purple-700',
};

export default function ApprovalRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEntityType, setFilterEntityType] = useState('');

  useEffect(() => {
    const params: Record<string, string> = {};
    if (filterStatus) params.status = filterStatus;
    if (filterEntityType) params.entityType = filterEntityType;
    const qs = new URLSearchParams(params).toString();
    fetch(`/api/backend/approvals/requests${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then((res: any) => setRequests(res.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterStatus, filterEntityType]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Approval Requests</h1>
        <p className="text-gray-500 mt-1">All approval requests across the group</p>
      </div>

      <div className="flex gap-3 mb-4">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <input
          type="text"
          placeholder="Filter by entity type..."
          value={filterEntityType}
          onChange={e => setFilterEntityType(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Request #', 'Entity Type', 'Action', 'Status', 'Requester', 'Amount', 'Created', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {requests.map(req => (
                <tr key={req.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-700">{req.requestNumber}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{req.entityType}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{req.triggerAction}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-500'}`}>
                      {req.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{req.requester?.fullName || req.requester?.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {req.amount
                      ? `${req.currency || ''} ${
                          Number.isFinite(Number(req.amount))
                            ? Number(req.amount).toLocaleString()
                            : '0'
                        }`
                      : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-400">{req.createdAt ? new Date(req.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="px-6 py-4 text-sm space-x-2">
                    <button className="text-blue-600 hover:underline">View</button>
                    {req.status === 'PENDING' && (
                      <>
                        <button className="text-green-600 hover:underline">Approve</button>
                        <button className="text-red-500 hover:underline">Reject</button>
                        <button className="text-gray-500 hover:underline">Cancel</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400">No requests found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
