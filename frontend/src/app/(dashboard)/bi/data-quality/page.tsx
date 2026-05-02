'use client'

import { useState, useEffect } from 'react'

interface DataQualitySummary {
  totalOpen?: number
  bySeverity?: Record<string, number>
}

interface DataQualityIssue {
  id: string
  issueNumber: string
  entityType: string
  issueType: string
  severity: string
  status: string
  detectedAt: string
}

export default function DataQualityPage() {
  const [issues, setIssues] = useState<DataQualityIssue[]>([])
  const [summary, setSummary] = useState<DataQualitySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningChecks, setRunningChecks] = useState(false)

  function loadData() {
    setLoading(true)
    Promise.all([
      fetch('/api/backend/bi/data-quality?limit=50').then((r) => r.json()),
      fetch('/api/backend/bi/data-quality/summary').then((r) => r.json()),
    ])
      .then(([issuesData, summaryData]: [DataQualityIssue[], DataQualitySummary]) => {
        setIssues(Array.isArray(issuesData) ? issuesData : [])
        setSummary(summaryData)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  function runChecks() {
    setRunningChecks(true)
    fetch('/api/backend/bi/data-quality/run-checks', { method: 'POST' })
      .then(() => loadData())
      .catch(console.error)
      .finally(() => setRunningChecks(false))
  }

  function updateIssue(id: string, action: 'resolve' | 'acknowledge' | 'dismiss') {
    fetch(`/api/backend/bi/data-quality/${id}/${action}`, { method: 'PATCH' })
      .then(() => loadData())
      .catch(console.error)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Data Quality</h1>
        <button
          onClick={runChecks}
          disabled={runningChecks}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {runningChecks ? 'Running...' : 'Run Checks'}
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-2xl font-bold text-gray-800">{summary.totalOpen ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1">Total Open</div>
          </div>
          {summary.bySeverity && Object.entries(summary.bySeverity).map(([sev, count]) => (
            <div key={sev} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-2xl font-bold text-gray-800">{count}</div>
              <div className="text-xs mt-1"><SeverityBadge value={sev} /></div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Issue #</th>
                <th className="px-4 py-3">Entity Type</th>
                <th className="px-4 py-3">Issue Type</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Detected</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {issues.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No issues found</td></tr>
              ) : (
                issues.map((issue) => (
                  <tr key={issue.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{issue.issueNumber}</td>
                    <td className="px-4 py-2">{issue.entityType}</td>
                    <td className="px-4 py-2 text-xs">{issue.issueType}</td>
                    <td className="px-4 py-2"><SeverityBadge value={issue.severity} /></td>
                    <td className="px-4 py-2"><StatusBadge value={issue.status} /></td>
                    <td className="px-4 py-2 text-xs">{issue.detectedAt ? new Date(issue.detectedAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 flex gap-1">
                      {issue.status === 'OPEN' && (
                        <>
                          <button
                            onClick={() => updateIssue(issue.id, 'acknowledge')}
                            className="px-2 py-1 rounded text-xs border border-yellow-300 text-yellow-600 hover:bg-yellow-50"
                          >
                            Ack
                          </button>
                          <button
                            onClick={() => updateIssue(issue.id, 'resolve')}
                            className="px-2 py-1 rounded text-xs border border-green-300 text-green-600 hover:bg-green-50"
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() => updateIssue(issue.id, 'dismiss')}
                            className="px-2 py-1 rounded text-xs border border-gray-300 text-gray-500 hover:bg-gray-50"
                          >
                            Dismiss
                          </button>
                        </>
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

function SeverityBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-700',
    HIGH: 'bg-orange-100 text-orange-700',
    MEDIUM: 'bg-yellow-100 text-yellow-700',
    LOW: 'bg-gray-100 text-gray-600',
  }
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[value] ?? 'bg-gray-100 text-gray-600'}`}>{value}</span>
}

function StatusBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    OPEN: 'bg-yellow-100 text-yellow-700',
    ACKNOWLEDGED: 'bg-blue-100 text-blue-700',
    RESOLVED: 'bg-green-100 text-green-700',
    DISMISSED: 'bg-gray-100 text-gray-500',
  }
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[value] ?? 'bg-gray-100 text-gray-600'}`}>{value}</span>
}
