'use client'

import { useState, useEffect } from 'react'

interface AnalyticsRun {
  id: string
  runNumber: string
  runType: string
  status: string
  companyId: string | null
  periodStart: string | null
  periodEnd: string | null
  startedAt: string | null
  completedAt: string | null
}

export default function AnalyticsRunsPage() {
  const [runs, setRuns] = useState<AnalyticsRun[]>([])
  const [loading, setLoading] = useState(true)

  function loadRuns() {
    setLoading(true)
    fetch('/api/backend/bi/analytics-runs?limit=50')
      .then((r) => r.json())
      .then((data: AnalyticsRun[]) => setRuns(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadRuns() }, [])

  function cancelRun(id: string) {
    fetch(`/api/backend/bi/analytics-runs/${id}/cancel`, { method: 'POST' })
      .then(() => loadRuns())
      .catch(console.error)
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analytics Snapshot Runs</h1>

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Run #</th>
                <th className="px-4 py-3">Run Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Period Start</th>
                <th className="px-4 py-3">Period End</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">No analytics runs found</td></tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{r.runNumber}</td>
                    <td className="px-4 py-2">{r.runType}</td>
                    <td className="px-4 py-2"><StatusBadge value={r.status} /></td>
                    <td className="px-4 py-2 text-xs">{r.companyId ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{r.periodStart ? new Date(r.periodStart).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 text-xs">{r.periodEnd ? new Date(r.periodEnd).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 text-xs">{r.startedAt ? new Date(r.startedAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 text-xs">{r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2">
                      {(r.status === 'RUNNING' || r.status === 'REQUESTED') && (
                        <button
                          onClick={() => cancelRun(r.id)}
                          className="px-2 py-1 rounded text-xs border border-red-300 text-red-600 hover:bg-red-50"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    COMPLETED: 'bg-green-100 text-green-700',
    RUNNING: 'bg-blue-100 text-blue-700',
    REQUESTED: 'bg-yellow-100 text-yellow-700',
    FAILED: 'bg-red-100 text-red-700',
    CANCELLED: 'bg-gray-100 text-gray-500',
  }
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[value] ?? 'bg-gray-100 text-gray-600'}`}>{value}</span>
}
