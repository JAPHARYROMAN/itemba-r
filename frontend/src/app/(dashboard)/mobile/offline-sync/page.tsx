'use client';

import { useState, useEffect, useCallback } from 'react';
import { unwrapList } from '@/lib/unwrap';

interface SyncBatch {
  id: string;
  batchNumber: string;
  userId: string;
  syncDirection: string;
  status: string;
  recordCount: number;
  processedCount: number;
  failedCount: number;
  conflictCount: number;
  completedAt: string | null;
}

interface SyncConflict {
  id: string;
  clientRecordId: string;
  entityType: string;
  operation: string;
  conflictReason: string;
  status: string;
}

interface SyncCheckpoint {
  id: string;
  userId: string;
  deviceId: string;
  entityType: string;
  lastSyncAt: string | null;
  lastServerCursor: string | null;
}

type TabType = 'batches' | 'conflicts' | 'checkpoints';

const BATCH_STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  PARTIAL: 'bg-orange-100 text-orange-700',
};

const CONFLICT_STATUS_COLORS: Record<string, string> = {
  RESOLVED: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  IGNORED: 'bg-gray-100 text-gray-600',
};

export default function OfflineSyncPage() {
  const [activeTab, setActiveTab] = useState<TabType>('batches');
  const [batches, setBatches] = useState<SyncBatch[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [checkpoints, setCheckpoints] = useState<SyncCheckpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadBatches = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/sync-batches?limit=50')
      .then(r => r.json())
      .then(data => setBatches(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const loadConflicts = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/sync-conflicts?limit=50')
      .then(r => r.json())
      .then(data => setConflicts(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const loadCheckpoints = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/sync-checkpoints?limit=50')
      .then(r => r.json())
      .then(data => setCheckpoints(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'batches') loadBatches();
    else if (activeTab === 'conflicts') loadConflicts();
    else loadCheckpoints();
  }, [activeTab, loadBatches, loadConflicts, loadCheckpoints]);

  async function resolveConflict(id: string) {
    setResolvingId(id);
    try {
      await fetch(`/api/backend/sync-conflicts/${id}/resolve`, { method: 'POST' });
      loadConflicts();
    } catch (e) { console.error(e); }
    finally { setResolvingId(null); }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Offline Sync</h1>
        <p className="text-gray-500 mt-1">Monitor sync batches and resolve conflicts</p>
      </div>

      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {(['batches', 'conflicts', 'checkpoints'] as TabType[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors -mb-px ${activeTab === tab ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          {activeTab === 'batches' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                    <th className="px-4 py-3">Batch #</th>
                    <th className="px-4 py-3">User ID</th>
                    <th className="px-4 py-3">Direction</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Records</th>
                    <th className="px-4 py-3">Processed</th>
                    <th className="px-4 py-3">Failed</th>
                    <th className="px-4 py-3">Conflicts</th>
                    <th className="px-4 py-3">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-8 text-gray-400">No batches found</td></tr>
                  ) : batches.map(b => (
                    <tr key={b.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{b.batchNumber}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{b.userId}</td>
                      <td className="px-4 py-3">{b.syncDirection}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${BATCH_STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-600'}`}>{b.status}</span></td>
                      <td className="px-4 py-3">{b.recordCount}</td>
                      <td className="px-4 py-3 text-green-700">{b.processedCount}</td>
                      <td className="px-4 py-3 text-red-700">{b.failedCount}</td>
                      <td className="px-4 py-3 text-yellow-700">{b.conflictCount}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{b.completedAt ? new Date(b.completedAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'conflicts' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                    <th className="px-4 py-3">Client Record ID</th>
                    <th className="px-4 py-3">Entity Type</th>
                    <th className="px-4 py-3">Operation</th>
                    <th className="px-4 py-3">Conflict Reason</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400">No conflicts found</td></tr>
                  ) : conflicts.map(c => (
                    <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{c.clientRecordId}</td>
                      <td className="px-4 py-3">{c.entityType}</td>
                      <td className="px-4 py-3">{c.operation}</td>
                      <td className="px-4 py-3 text-gray-600">{c.conflictReason}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${CONFLICT_STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-600'}`}>{c.status}</span></td>
                      <td className="px-4 py-3">
                        {c.status === 'PENDING' && (
                          <button onClick={() => resolveConflict(c.id)} disabled={resolvingId === c.id} className="text-blue-600 hover:underline text-xs disabled:opacity-50">
                            {resolvingId === c.id ? 'Resolving...' : 'Resolve'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'checkpoints' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                    <th className="px-4 py-3">User ID</th>
                    <th className="px-4 py-3">Device ID</th>
                    <th className="px-4 py-3">Entity Type</th>
                    <th className="px-4 py-3">Last Sync</th>
                    <th className="px-4 py-3">Last Server Cursor</th>
                  </tr>
                </thead>
                <tbody>
                  {checkpoints.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400">No checkpoints found</td></tr>
                  ) : checkpoints.map(cp => (
                    <tr key={cp.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{cp.userId}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{cp.deviceId}</td>
                      <td className="px-4 py-3">{cp.entityType}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{cp.lastSyncAt ? new Date(cp.lastSyncAt).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{cp.lastServerCursor ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
