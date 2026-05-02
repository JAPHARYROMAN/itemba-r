'use client'

import { useState, useEffect } from 'react'

interface ExecSummary {
  kpiSnapshotCount?: number
  pendingApprovals?: number
  openInsights?: number
  insights?: Array<{
    id: string
    insightNumber: string
    title: string
    insightType: string
    severity: string
    status: string
  }>
  openDataQualityIssues?: number
}

export default function ExecutiveDashboardPage() {
  const [summary, setSummary] = useState<ExecSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/backend/bi/executive-summary')
      .then((r) => r.json())
      .then((data: ExecSummary) => setSummary(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Executive Dashboard</h1>

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading...</p>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <StatCard label="Total KPI Snapshots" value={summary?.kpiSnapshotCount ?? '—'} color="blue" />
            <StatCard label="Pending Approvals" value={summary?.pendingApprovals ?? '—'} color="yellow" />
            <StatCard label="Open Insights" value={summary?.openInsights ?? '—'} color="green" />
          </div>

          {/* Recent Insights */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
            <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-800">Recent Insights</div>
            {summary?.insights && summary.insights.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                    <th className="px-4 py-2">Number</th>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Severity</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.insights.map((ins) => (
                    <tr key={ins.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{ins.insightNumber}</td>
                      <td className="px-4 py-2">{ins.title}</td>
                      <td className="px-4 py-2">{ins.insightType}</td>
                      <td className="px-4 py-2"><SeverityBadge value={ins.severity} /></td>
                      <td className="px-4 py-2">{ins.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-5 py-4 text-gray-400 text-sm">No insights available.</p>
            )}
          </div>

          {/* Data Quality Summary */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="font-semibold text-gray-800 mb-1">Data Quality</div>
            <p className="text-sm text-gray-600">
              Open Issues: <span className="font-bold text-red-600">{summary?.openDataQualityIssues ?? '—'}</span>
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: 'blue' | 'yellow' | 'green' }) {
  const colors = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    green: 'bg-green-50 border-green-200 text-green-700',
  }
  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm mt-1 opacity-80">{label}</div>
    </div>
  )
}

function SeverityBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-700',
    HIGH: 'bg-orange-100 text-orange-700',
    NORMAL: 'bg-blue-100 text-blue-700',
    LOW: 'bg-gray-100 text-gray-600',
  }
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[value] ?? 'bg-gray-100 text-gray-600'}`}>{value}</span>
}
