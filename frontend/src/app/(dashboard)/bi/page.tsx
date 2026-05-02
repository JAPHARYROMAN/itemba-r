'use client'

import Link from 'next/link'

const sections = [
  { title: 'Executive Dashboard', href: '/bi/executive', desc: 'Group-wide KPIs and executive summary' },
  { title: 'KPI Indicators', href: '/bi/kpis', desc: 'Manage and view KPI definitions' },
  { title: 'KPI Snapshots', href: '/bi/kpi-snapshots', desc: 'Historical KPI snapshots' },
  { title: 'Report Definitions', href: '/bi/reports', desc: 'Available report definitions' },
  { title: 'Report Builder', href: '/bi/report-builder', desc: 'Run reports with custom filters' },
  { title: 'Saved Views', href: '/bi/saved-views', desc: 'Saved report configurations' },
  { title: 'Scheduled Reports', href: '/bi/scheduled-reports', desc: 'Manage scheduled report delivery' },
  { title: 'Dashboards', href: '/bi/dashboards', desc: 'BI dashboard definitions' },
  { title: 'Executive Insights', href: '/bi/insights', desc: 'AI-assisted executive insights' },
  { title: 'Data Quality', href: '/bi/data-quality', desc: 'Data integrity and quality issues' },
  { title: 'Report Runs', href: '/bi/report-runs', desc: 'Report execution history' },
  { title: 'Analytics Runs', href: '/bi/analytics-runs', desc: 'Snapshot and analytics run history' },
]

export default function BIOverviewPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">BI & Executive Intelligence</h1>
      <p className="text-gray-500 mb-8">Group-wide analytics, KPIs, reports and executive insights</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-blue-400 transition-all group"
          >
            <div className="font-semibold text-gray-800 group-hover:text-blue-600 mb-1">{s.title}</div>
            <div className="text-sm text-gray-500">{s.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
