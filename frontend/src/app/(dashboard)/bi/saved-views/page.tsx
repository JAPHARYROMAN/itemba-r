'use client'

import { useState, useEffect } from 'react'

interface SavedReportView {
  id: string
  name: string
  reportDefinitionId: string
  isDefault: boolean
  isShared: boolean
  createdAt: string
}

export default function SavedViewsPage() {
  const [views, setViews] = useState<SavedReportView[]>([])
  const [loading, setLoading] = useState(true)

  function loadViews() {
    setLoading(true)
    fetch('/api/backend/bi/saved-report-views?limit=50')
      .then((r) => r.json())
      .then((data: SavedReportView[]) => setViews(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadViews() }, [])

  function shareView(id: string) {
    fetch(`/api/backend/bi/saved-report-views/${id}/share`, { method: 'PATCH' })
      .then(() => loadViews())
      .catch(console.error)
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Saved Report Views</h1>

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Report Def. ID</th>
                <th className="px-4 py-3">Default</th>
                <th className="px-4 py-3">Shared</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {views.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No saved views found</td></tr>
              ) : (
                views.map((v) => (
                  <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{v.name}</td>
                    <td className="px-4 py-2 font-mono text-xs">{v.reportDefinitionId}</td>
                    <td className="px-4 py-2">
                      {v.isDefault && <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">Default</span>}
                    </td>
                    <td className="px-4 py-2">
                      {v.isShared ? (
                        <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">Shared</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">Private</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs">{v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2">
                      {!v.isShared && (
                        <button
                          onClick={() => shareView(v.id)}
                          className="px-3 py-1 rounded text-xs font-medium border border-blue-300 text-blue-600 hover:bg-blue-50"
                        >
                          Share
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
