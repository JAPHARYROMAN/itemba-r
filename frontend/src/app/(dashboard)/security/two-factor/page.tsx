'use client';

import { useState, useEffect } from 'react';
import { backendList } from '@/lib/api-client';

export default function TwoFactorAuthPage() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    backendList<any>('user-security-profiles')
      .then(setProfiles)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const enabled = profiles.filter((p) => p.twoFactorEnabled).length;
  const total = profiles.length;
  const pct = total > 0 ? Math.round((enabled / total) * 100) : 0;

  const statCards = [
    { label: 'Total Users', value: total, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: '2FA Enabled', value: enabled, color: 'bg-green-50 text-green-700 border-green-200' },
    {
      label: '2FA Disabled',
      value: total - enabled,
      color: 'bg-red-50 text-red-700 border-red-200',
    },
    {
      label: 'Adoption Rate',
      value: `${pct}%`,
      color: 'bg-purple-50 text-purple-700 border-purple-200',
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Two-Factor Authentication</h1>
        <p className="text-gray-500 mt-1">2FA adoption statistics and admin guidance</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map((card) => (
              <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
                <div className="text-3xl font-bold">{card.value}</div>
                <div className="text-sm font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Adoption Progress</h2>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-gray-200 rounded-full h-3">
                <div className="bg-green-500 h-3 rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm font-semibold text-gray-700">{pct}%</span>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              {enabled} of {total} users have 2FA enabled
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-blue-900 mb-3">Admin Guidance</h2>
            <ul className="list-disc list-inside space-y-2 text-sm text-blue-800">
              <li>
                Navigate to <strong>User Security Profiles</strong> to see which users have 2FA
                disabled
              </li>
              <li>
                Use <strong>Security Policies</strong> to enforce 2FA requirements system-wide
              </li>
              <li>Users can enable 2FA from their profile settings page</li>
              <li>TOTP (Time-based One-Time Password) is the supported 2FA method</li>
              <li>After enabling enforcement, users without 2FA will be prompted on next login</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
