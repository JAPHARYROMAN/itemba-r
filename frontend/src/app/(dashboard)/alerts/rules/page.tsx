'use client';
import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  NORMAL: 'bg-blue-100 text-blue-700',
  LOW: 'bg-gray-100 text-gray-500',
};

export default function AlertRulesPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/alert-rules').then(r => r.json())
      .then((res: any) => setRules(res.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alert Rules</h1>
          <p className="text-gray-500 mt-1">Configure automated alert rules</p>
        </div>
        <button className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
          + New Alert Rule
        </button>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Code', 'Name', 'Type', 'Priority', 'Frequency', 'Active', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rules.map(rule => (
                <tr key={rule.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-700">{rule.alertRuleCode}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{rule.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{rule.alertType}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[rule.priority] || 'bg-gray-100 text-gray-500'}`}>
                      {rule.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{rule.frequency}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${rule.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm space-x-2">
                    <button className="text-blue-600 hover:underline">Edit</button>
                    <button className="text-gray-500 hover:underline">{rule.isActive ? 'Deactivate' : 'Activate'}</button>
                    <button className="text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">No alert rules found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
