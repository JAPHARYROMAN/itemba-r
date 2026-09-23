'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErrorState, PageSpinner } from '@/components/ui';
import { backendList } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';

export default function TwoFactorAuthPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('two_factor.manage');
  const beginRequest = useRequestGuard();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setLoadError('');
    try {
      const rows = await backendList<any>('user-security-profiles', { signal: request.signal });
      if (!request.current()) return;
      setProfiles(rows);
    } catch {
      if (!request.current()) return;
      setLoadError('Failed to load 2FA statistics.');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [authLoading, beginRequest, canView]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (authLoading || !canView) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900">Two-Factor Authentication</h1>
        <p className="text-gray-500 mt-1">{authLoading ? 'Loading' : 'Access Restricted'}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Two-Factor Authentication</h1>
        <p className="text-gray-500 mt-1">2FA adoption statistics and admin guidance</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
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
