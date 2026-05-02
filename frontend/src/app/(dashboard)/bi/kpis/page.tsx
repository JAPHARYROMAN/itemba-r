'use client'

import { useState, useEffect } from 'react'

interface KPIIndicator {
  id: string
  kpiCode: string
  name: string
  kpiCategory: string
  calculationType: string
  isActive: boolean
  isSensitive: boolean
}

export default function KPIsPage() {
  const [kpis, setKpis] = useState<KPIIndicator[]>([])
  const [loading, setLoading] = useState(true)

  function loadKpis() {
    setLoading(true)
    fetch('/api/backend/bi/kpis?limit=50')
      .then((r) => r.json())
      .then((data: KPIIndicator[]) => setKpis(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadKpis() }, [])

  function toggleActive(id: string, isActive: boolean) {
    const path = isActive ? 'deactivate' : 'activate'
    fetch(`/api/backend/bi/kpis/${id}/${path}`, { method: 'PATCH' })
      .then(() => loadKpis())
      .catch(console.error)
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">KPI Indicators</h1>

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Calc Type</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Sensitive</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {kpis.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No KPIs found</td></tr>
              ) : (
                kpis.map((k) => (
                  <tr key={k.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{k.kpiCode}</td>
                    <td className="px-4 py-2 font-medium">{k.name}</td>
                    <td className="px-4 py-2">{k.kpiCategory}</td>
                    <td className="px-4 py-2">{k.calculationType}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${k.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {k.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {k.isSensitive && <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-700">Sensitive</span>}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => toggleActive(k.id, k.isActive)}
                        className={`px-3 py-1 rounded text-xs font-medium border ${k.isActive ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-green-300 text-green-600 hover:bg-green-50'}`}
                      >
                        {k.isActive ? 'Deactivate' : 'Activate'}
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
