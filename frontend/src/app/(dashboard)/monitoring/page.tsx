'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const HEALTH_COLORS: Record<string, string> = {
  HEALTHY: 'bg-green-50 border-green-200 text-green-700',
  WARNING: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  CRITICAL: 'bg-red-50 border-red-200 text-red-700',
  UNKNOWN: 'bg-gray-50 border-gray-200 text-gray-500',
};

const LOG_SEVERITY_COLORS: Record<string, string> = {
  ERROR: 'bg-red-100 text-red-700',
  CRITICAL: 'bg-red-100 text-red-800',
  WARNING: 'bg-yellow-100 text-yellow-700',
  INFO: 'bg-blue-100 text-blue-700',
};

export default function MonitoringDashboardPage() {
  const [healthChecks, setHealthChecks] = useState<any[]>([]);
  const [errorLogs, setErrorLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/monitoring/dashboard')
      .then(r => r.json())
      .then(res => {
        const d = res?.data ?? res;
        setHealthChecks(Array.isArray(d.healthChecks) ? d.healthChecks : []);
        setErrorLogs(Array.isArray(d.recentErrors) ? d.recentErrors : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const quickLinks = [
    { label: 'Health Checks', href: '/monitoring/health-checks', desc: 'Run and view system health checks' },
    { label: 'Error Logs', href: '/monitoring/error-logs', desc: 'Review and resolve error logs' },
    { label: 'System Metrics', href: '/monitoring/metrics', desc: 'View system performance metrics' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Monitoring Dashboard</h1>
        <p className="text-gray-500 mt-1">System health status and recent errors</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          {healthChecks.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-gray-800 mb-3">System Health</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {healthChecks.map((hc: any) => (
                  <div key={hc.id} className={`rounded-xl border p-4 ${HEALTH_COLORS[hc.status] ?? 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                    <div className="font-semibold text-sm">{hc.name}</div>
                    <div className="text-xs mt-1 opacity-80">{hc.status}</div>
                    {hc.responseTimeMs != null && <div className="text-xs mt-0.5 opacity-60">{hc.responseTimeMs}ms</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {errorLogs.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-8">
              <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-800">Recent Error Logs</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                    <th className="px-4 py-2">Module</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Severity</th>
                    <th className="px-4 py-2">Message</th>
                    <th className="px-4 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {errorLogs.map((log: any) => (
                    <tr key={log.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2">{log.module ?? '—'}</td>
                      <td className="px-4 py-2">{log.errorType ?? '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${LOG_SEVERITY_COLORS[log.severity] ?? 'bg-gray-100 text-gray-600'}`}>{log.severity}</span>
                      </td>
                      <td className="px-4 py-2 max-w-[280px] truncate text-gray-600">{log.message}</td>
                      <td className="px-4 py-2 text-gray-400">{log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {quickLinks.map(link => (
              <Link key={link.href} href={link.href} className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <div className="font-semibold text-gray-900 mb-1">{link.label}</div>
                <div className="text-sm text-gray-500">{link.desc}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
