'use client';

import { useState, useEffect, useCallback } from 'react';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  DEPLOYING: 'bg-blue-100 text-blue-700',
  DEPLOYED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  ROLLED_BACK: 'bg-orange-100 text-orange-700',
  CANCELLED: 'bg-gray-200 text-gray-500',
};

const MIGRATION_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  RUNNING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

interface NewReleaseForm {
  version: string;
  environment: string;
  notes: string;
  imageTag: string;
  commitHash: string;
}

export default function DeploymentReleasesPage() {
  const [releases, setReleases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewReleaseForm>({ version: '', environment: 'staging', notes: '', imageTag: '', commitHash: '' });
  const [saving, setSaving] = useState(false);

  const fetchReleases = useCallback(() => {
    setLoading(true);
    fetch(`/api/backend/deployment-releases?page=${page}&limit=${limit}`)
      .then(r => r.json())
      .then(res => {
        setReleases(res.data ?? res.releases ?? []);
        setTotal(res.total ?? res.meta?.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { fetchReleases(); }, [fetchReleases]);

  async function createRelease() {
    setSaving(true);
    try {
      const res = await fetch('/api/backend/deployment-releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowModal(false);
        setForm({ version: '', environment: 'staging', notes: '', imageTag: '', commitHash: '' });
        fetchReleases();
      }
    } finally {
      setSaving(false);
    }
  }

  async function deployRelease(id: string) {
    await fetch(`/api/backend/deployment-releases/${id}/deploy`, { method: 'PUT' });
    fetchReleases();
  }

  async function failRelease(id: string) {
    await fetch(`/api/backend/deployment-releases/${id}/fail`, { method: 'PUT' });
    fetchReleases();
  }

  async function rollbackRelease(id: string) {
    await fetch(`/api/backend/deployment-releases/${id}/rollback`, { method: 'PUT' });
    fetchReleases();
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deployment Releases</h1>
          <p className="text-gray-500 mt-1">Manage and track versioned application releases</p>
        </div>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          + New Release
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th className="px-4 py-3">Release #</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Environment</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Migration Status</th>
              <th className="px-4 py-3">Image Tag</th>
              <th className="px-4 py-3">Deployed At</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
            ) : releases.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No releases found</td></tr>
            ) : releases.map((r: any) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.releaseNumber ?? r.id?.slice(0, 8) ?? '—'}</td>
                <td className="px-4 py-3 font-medium">{r.version ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{r.environment ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-600'}`}>{r.status ?? '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${MIGRATION_COLORS[r.migrationStatus] ?? 'bg-gray-100 text-gray-600'}`}>{r.migrationStatus ?? '—'}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500 max-w-[120px] truncate">{r.imageTag ?? '—'}</td>
                <td className="px-4 py-3 text-gray-400">{r.deployedAt ? new Date(r.deployedAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => deployRelease(r.id)} className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100">Deploy</button>
                    <button onClick={() => failRelease(r.id)} className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100">Fail</button>
                    <button onClick={() => rollbackRelease(r.id)} className="px-2 py-1 text-xs bg-orange-50 text-orange-700 rounded hover:bg-orange-100">Rollback</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
            <span>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-40">‹ Prev</button>
              <button onClick={() => setPage(p => p + 1)} disabled={page * limit >= total} className="px-3 py-1 border rounded disabled:opacity-40">Next ›</button>
            </div>
          </div>
        )}
      </div>

      {/* New Release Modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Release</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Version *</label>
                <input value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. v1.2.0" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Environment *</label>
                <select value={form.environment} onChange={e => setForm(f => ({ ...f, environment: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                  <option value="development">Development</option>
                  <option value="testing">Testing</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Image Tag</label>
                <input value={form.imageTag} onChange={e => setForm(f => ({ ...f, imageTag: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="sha256:abc123..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Commit Hash</label>
                <input value={form.commitHash} onChange={e => setForm(f => ({ ...f, commitHash: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="abc1234..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" rows={3} />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={createRelease} disabled={saving || !form.version} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Release'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
