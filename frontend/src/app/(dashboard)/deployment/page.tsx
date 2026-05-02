'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function DeploymentDashboardPage() {
  const [stats, setStats] = useState({ totalReleases: 0, deployed: 0, failed: 0, rolledBack: 0 });
  const [lastProdDeploy, setLastProdDeploy] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/deployment/dashboard')
      .then(r => r.json())
      .then(res => {
        const d = res.data ?? res;
        setStats({
          totalReleases: d.totalReleases ?? 0,
          deployed: d.deployed ?? 0,
          failed: d.failed ?? 0,
          rolledBack: d.rolledBack ?? 0,
        });
        setLastProdDeploy(d.lastProductionDeploy ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: 'Total Releases', value: stats.totalReleases, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: 'Deployed', value: stats.deployed, color: 'bg-green-50 text-green-700 border-green-200' },
    { label: 'Failed', value: stats.failed, color: 'bg-red-50 text-red-700 border-red-200' },
    { label: 'Rolled Back', value: stats.rolledBack, color: 'bg-orange-50 text-orange-700 border-orange-200' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deployment Dashboard</h1>
          <p className="text-gray-500 mt-1">Release management and deployment automation overview</p>
        </div>
        <Link href="/deployment/releases" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          View Releases
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map(card => (
              <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
                <div className="text-3xl font-bold">{card.value}</div>
                <div className="text-sm font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          {lastProdDeploy && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Last Production Deployment</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-xs text-gray-400 uppercase mb-0.5">Version</div>
                  <div className="font-medium text-gray-800">{lastProdDeploy.version ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase mb-0.5">Status</div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${lastProdDeploy.status === 'DEPLOYED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{lastProdDeploy.status ?? '—'}</span>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase mb-0.5">Image Tag</div>
                  <div className="font-mono text-xs text-gray-700">{lastProdDeploy.imageTag ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase mb-0.5">Deployed At</div>
                  <div className="text-gray-600">{lastProdDeploy.deployedAt ? new Date(lastProdDeploy.deployedAt).toLocaleString() : '—'}</div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-1 max-w-xs">
            <Link href="/deployment/releases" className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="font-semibold text-gray-900 mb-1">Deployment Releases</div>
              <div className="text-sm text-gray-500">Create and manage versioned deployment releases</div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
