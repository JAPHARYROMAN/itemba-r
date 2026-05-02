'use client'

import { useState, useEffect } from 'react'

interface ScheduledReport {
  id: string
  scheduleCode: string
  name: string
  frequency: string
  exportFormat: string
  isActive: boolean
  lastRunAt: string | null
  nextRunAt: string | null
}

export default function ScheduledReportsPage() {
  const [schedules, setSchedules] = useState<ScheduledReport[]>([])
  const [loading, setLoading] = useState(true)

  function loadSchedules() {
    setLoading(true)
    fetch('/api/backend/bi/scheduled-reports?limit=50')
      .then((r) => r.json())
      .then((data: ScheduledReport[]) => setSchedules(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadSchedules() }, [])

  function runNow(id: string) {
    fetch(`/api/backend/bi/scheduled-reports/${id}/run`, { method: 'POST' })
      .then(() => loadSchedules())
      .catch(console.error)
  }

  function toggleActive(id: string, isActive: boolean) {
    const path = isActive ? 'deactivate' : 'activate'
    fetch(`/api/backend/bi/scheduled-reports/${id}/${path}`, { method: 'PATCH' })
      .then(() => loadSchedules())
      .catch(console.error)
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Scheduled Reports</h1>

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Last Run</th>
                <th className="px-4 py-3">Next Run</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">No scheduled reports found</td></tr>
              ) : (
                schedules.map((s) => (
                  <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{s.scheduleCode}</td>
                    <td className="px-4 py-2 font-medium">{s.name}</td>
                    <td className="px-4 py-2">{s.frequency}</td>
                    <td className="px-4 py-2">{s.exportFormat}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {s.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs">{s.lastRunAt ? new Date(s.lastRunAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 text-xs">{s.nextRunAt ? new Date(s.nextRunAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 flex gap-1">
                      <button
                        onClick={() => runNow(s.id)}
                        className="px-2 py-1 rounded text-xs border border-blue-300 text-blue-600 hover:bg-blue-50"
                      >
                        Run Now
                      </button>
                      <button
                        onClick={() => toggleActive(s.id, s.isActive)}
                        className={`px-2 py-1 rounded text-xs border ${s.isActive ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-green-300 text-green-600 hover:bg-green-50'}`}
                      >
                        {s.isActive ? 'Deactivate' : 'Activate'}
                      </button>
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
