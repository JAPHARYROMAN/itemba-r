'use client';

import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';
import { backendList } from '@/lib/api-client';

const RISK_COLORS: Record<string, string> = {
  LOW: 'bg-green-100 text-green-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  HIGH: 'bg-orange-100 text-orange-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

export default function UserSecurityProfilesPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    backendList<any>('user-security-profiles')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">User Security Profiles</h1>
        <p className="text-gray-500 mt-1">
          View 2FA status, risk levels, and login history per user
        </p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">2FA Enabled</th>
                <th className="px-4 py-3">Risk Level</th>
                <th className="px-4 py-3">Last Login</th>
                <th className="px-4 py-3">Failed Attempts</th>
                <th className="px-4 py-3">Force Password Change</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No profiles found
                  </td>
                </tr>
              ) : (
                data.map((row: any) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{row.user?.name ?? row.userId}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${row.twoFactorEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {row.twoFactorEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${RISK_COLORS[row.securityRiskLevel] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {row.securityRiskLevel ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">{row.failedLoginAttempts ?? 0}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${row.forcePasswordChange ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {row.forcePasswordChange ? 'Yes' : 'No'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
