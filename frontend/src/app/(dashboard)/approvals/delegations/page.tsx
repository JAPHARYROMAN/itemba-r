'use client';
import { useState, useEffect } from 'react';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
  CANCELLED: 'bg-red-100 text-red-600',
  PENDING: 'bg-yellow-100 text-yellow-700',
};

export default function DelegationsPage() {
  const [delegations, setDelegations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/approvals/delegations').then(r => r.json())
      .then((res: any) => setDelegations(res.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval Delegations</h1>
          <p className="text-gray-500 mt-1">Manage approval authority delegations</p>
        </div>
        <button className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
          + New Delegation
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Delegator', 'Delegate', 'Entity Type', 'Start Date', 'End Date', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {delegations.map(d => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900">{d.delegator?.fullName || d.delegator?.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{d.delegate?.fullName || d.delegate?.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{d.entityType || 'All'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{d.startDate ? new Date(d.startDate).toLocaleDateString() : '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{d.endDate ? new Date(d.endDate).toLocaleDateString() : '—'}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[d.status] || 'bg-gray-100 text-gray-500'}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm space-x-2">
                    {d.status === 'ACTIVE' && <button className="text-red-500 hover:underline">Cancel</button>}
                    <button className="text-red-400 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
              {delegations.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">No delegations found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
