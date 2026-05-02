'use client'

import { useState, useEffect } from 'react'

interface DashboardWidget {
  id: string
  widgetCode: string
  title: string
  widgetType: string
  dataSourceType: string
}

interface DashboardDef {
  id: string
  dashboardCode: string
  name: string
  dashboardType: string
  isSystemDashboard: boolean
  widgets?: DashboardWidget[]
}

export default function DashboardsPage() {
  const [dashboards, setDashboards] = useState<DashboardDef[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<DashboardDef | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    fetch('/api/backend/bi/dashboards?limit=20')
      .then((r) => r.json())
      .then((data: DashboardDef[]) => setDashboards(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function loadDetail(id: string) {
    setLoadingDetail(true)
    fetch(`/api/backend/bi/dashboards/${id}`)
      .then((r) => r.json())
      .then((data: DashboardDef) => setSelected(data))
      .catch(console.error)
      .finally(() => setLoadingDetail(false))
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard Definitions</h1>

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {dashboards.length === 0 ? (
            <p className="text-gray-400">No dashboards found</p>
          ) : (
            dashboards.map((d) => (
              <div
                key={d.id}
                onClick={() => loadDetail(d.id)}
                className={`rounded-xl border p-5 cursor-pointer transition-all hover:shadow-md ${selected?.id === d.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}`}
              >
                <div className="font-semibold text-gray-800 mb-1">{d.name}</div>
                <div className="text-xs text-gray-500 mb-2 font-mono">{d.dashboardCode}</div>
                <div className="flex gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{d.dashboardType}</span>
                  {d.isSystemDashboard && <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">System</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {loadingDetail && <p className="text-gray-500 animate-pulse">Loading widgets...</p>}

      {selected && !loadingDetail && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-800">
            Widgets — {selected.name}
          </div>
          {selected.widgets && selected.widgets.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                  <th className="px-4 py-2">Code</th>
                  <th className="px-4 py-2">Title</th>
                  <th className="px-4 py-2">Widget Type</th>
                  <th className="px-4 py-2">Data Source</th>
                </tr>
              </thead>
              <tbody>
                {selected.widgets.map((w) => (
                  <tr key={w.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{w.widgetCode}</td>
                    <td className="px-4 py-2">{w.title}</td>
                    <td className="px-4 py-2">{w.widgetType}</td>
                    <td className="px-4 py-2">{w.dataSourceType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-4 text-gray-400 text-sm">No widgets configured.</p>
          )}
        </div>
      )}
    </div>
  )
}
