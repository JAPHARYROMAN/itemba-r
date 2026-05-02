'use client';
import { useState, useEffect } from 'react';

const ENFORCEMENT_COLORS: Record<string, string> = {
  BLOCKING: 'bg-red-100 text-red-700',
  APPROVAL_REQUIRED: 'bg-orange-100 text-orange-700',
  WARNING: 'bg-yellow-100 text-yellow-700',
  LOG_ONLY: 'bg-gray-100 text-gray-500',
};

export default function InternalControlsPage() {
  const [controls, setControls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/internal-controls').then(r => r.json())
      .then((res: any) => setControls(res.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Internal Controls</h1>
          <p className="text-gray-500 mt-1">System-wide internal control rules and enforcement policies</p>
        </div>
        <button className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
          + New Control
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Code', 'Name', 'Control Type', 'Enforcement Level', 'Entity Type', 'Active', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {controls.map(ctrl => (
                <tr key={ctrl.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-700">{ctrl.controlCode}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{ctrl.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{ctrl.controlType}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ENFORCEMENT_COLORS[ctrl.enforcementLevel] || 'bg-gray-100 text-gray-500'}`}>
                      {ctrl.enforcementLevel}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{ctrl.entityType || 'Global'}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ctrl.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {ctrl.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm space-x-2">
                    <button className="text-blue-600 hover:underline">Edit</button>
                    <button className="text-gray-500 hover:underline">{ctrl.isActive ? 'Deactivate' : 'Activate'}</button>
                    <button className="text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
              {controls.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">No internal controls found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
