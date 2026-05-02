'use client'

import { useState, useEffect } from 'react'

interface ReportDefinition {
  id: string
  reportCode: string
  name: string
}

interface RunResult {
  status?: string
  resultSummary?: string
  rowCount?: number
  executionTimeMs?: number
  error?: string
}

export default function ReportBuilderPage() {
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([])
  const [form, setForm] = useState({ reportDefinitionId: '', companyId: '', dateFrom: '', dateTo: '' })
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    fetch('/api/backend/bi/report-definitions?limit=50')
      .then((r) => r.json())
      .then((data: ReportDefinition[]) => setDefinitions(Array.isArray(data) ? data : []))
      .catch(console.error)
  }, [])

  function runReport() {
    if (!form.reportDefinitionId) return
    setRunning(true)
    setResult(null)
    fetch('/api/backend/bi/report-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportDefinitionId: form.reportDefinitionId,
        companyId: form.companyId || undefined,
        filters: {
          dateFrom: form.dateFrom || undefined,
          dateTo: form.dateTo || undefined,
        },
      }),
    })
      .then((r) => r.json())
      .then((data: RunResult) => setResult(data))
      .catch((err) => setResult({ error: String(err) }))
      .finally(() => setRunning(false))
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Report Builder</h1>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Report Definition</label>
            <select
              value={form.reportDefinitionId}
              onChange={(e) => setForm({ ...form, reportDefinitionId: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">— Select Report —</option>
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.reportCode})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company ID (optional)</label>
            <input
              type="text"
              placeholder="Leave blank for group-wide"
              value={form.companyId}
              onChange={(e) => setForm({ ...form, companyId: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date From</label>
              <input
                type="date"
                value={form.dateFrom}
                onChange={(e) => setForm({ ...form, dateFrom: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date To</label>
              <input
                type="date"
                value={form.dateTo}
                onChange={(e) => setForm({ ...form, dateTo: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            onClick={runReport}
            disabled={running || !form.reportDefinitionId}
            className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? 'Running...' : 'Run Report'}
          </button>
        </div>

        {result && (
          <div className={`mt-5 p-4 rounded-lg text-sm ${result.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
            {result.error ? (
              <p>Error: {result.error}</p>
            ) : (
              <div className="space-y-1">
                <p><strong>Status:</strong> {result.status}</p>
                <p><strong>Summary:</strong> {result.resultSummary ?? '—'}</p>
                <p><strong>Row Count:</strong> {result.rowCount ?? '—'}</p>
                <p><strong>Execution Time:</strong> {result.executionTimeMs ?? '—'} ms</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
