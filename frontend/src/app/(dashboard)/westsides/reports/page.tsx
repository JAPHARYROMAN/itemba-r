'use client';

import { useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportCard {
  key: string;
  title: string;
  description: string;
  endpoint: string;
  icon: string;
  color: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v);
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
      return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return v;
  }
  return String(v);
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Report Configuration ─────────────────────────────────────────────────────

const REPORTS: ReportCard[] = [
  {
    key: 'sales-by-channel',
    title: 'Sales by Channel',
    description: 'Sales breakdown by retail, wholesale, and hardware channels',
    endpoint: '/api/backend/westsides/reports/sales-by-channel',
    icon: '📊',
    color: 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100',
  },
  {
    key: 'sales-by-product',
    title: 'Sales by Product',
    description: 'Sales volume and revenue by product',
    endpoint: '/api/backend/westsides/reports/sales-by-product',
    icon: '📦',
    color: 'bg-blue-50 border-blue-200 hover:bg-blue-100',
  },
  {
    key: 'daily-sales-summary',
    title: 'Daily Sales Summary',
    description: 'Day-by-day sales totals and transaction counts',
    endpoint: '/api/backend/westsides/reports/daily-sales-summary',
    icon: '📅',
    color: 'bg-sky-50 border-sky-200 hover:bg-sky-100',
  },
  {
    key: 'monthly-sales-summary',
    title: 'Monthly Sales Summary',
    description: 'Month-over-month sales performance',
    endpoint: '/api/backend/westsides/reports/monthly-sales-summary',
    icon: '📈',
    color: 'bg-violet-50 border-violet-200 hover:bg-violet-100',
  },
  {
    key: 'product-profitability',
    title: 'Product Profitability',
    description: 'Gross margin and profit by product',
    endpoint: '/api/backend/westsides/reports/product-profitability',
    icon: '💰',
    color: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100',
  },
  {
    key: 'fast-moving-items',
    title: 'Fast Moving Items',
    description: 'Top selling products by volume',
    endpoint: '/api/backend/westsides/reports/fast-moving-items',
    icon: '🚀',
    color: 'bg-green-50 border-green-200 hover:bg-green-100',
  },
  {
    key: 'slow-moving-items',
    title: 'Slow Moving Items',
    description: 'Products with low sales velocity',
    endpoint: '/api/backend/westsides/reports/slow-moving-items',
    icon: '🐢',
    color: 'bg-amber-50 border-amber-200 hover:bg-amber-100',
  },
  {
    key: 'batch-status',
    title: 'Batch Status Report',
    description: 'Status and expiry of all product batches',
    endpoint: '/api/backend/westsides/reports/batch-status',
    icon: '🏷️',
    color: 'bg-orange-50 border-orange-200 hover:bg-orange-100',
  },
  {
    key: 'stock-damage-report',
    title: 'Stock Damage Report',
    description: 'Damage and breakage summary by type and product',
    endpoint: '/api/backend/westsides/reports/stock-damage-report',
    icon: '⚠️',
    color: 'bg-red-50 border-red-200 hover:bg-red-100',
  },
  {
    key: 'quotation-conversion',
    title: 'Quotation Conversion',
    description: 'Quotation to order conversion rates',
    endpoint: '/api/backend/westsides/reports/quotation-conversion',
    icon: '🔄',
    color: 'bg-purple-50 border-purple-200 hover:bg-purple-100',
  },
  {
    key: 'credit-customers',
    title: 'Credit Customers',
    description: 'Credit balances and receivables by customer',
    endpoint: '/api/backend/westsides/reports/credit-customers-report',
    icon: '💳',
    color: 'bg-rose-50 border-rose-200 hover:bg-rose-100',
  },
];

// ─── Report Table ─────────────────────────────────────────────────────────────

interface ReportTableProps {
  data: Record<string, unknown>[];
}

function ReportTable({ data }: ReportTableProps) {
  if (data.length === 0) return <p className="text-sm text-slate-400 text-center py-8">No data returned.</p>;
  const columns = Object.keys(data[0]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {columns.map((col) => (
              <th key={col} className={thCls}>{col.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {columns.map((col) => (
                <td key={col} className={tdCls}>{fmtValue(row[col])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WestsideReportsPage() {
  const [activeReport, setActiveReport] = useState<ReportCard | null>(null);
  const [reportData, setReportData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadReport = async (report: ReportCard) => {
    setActiveReport(report);
    setLoading(true); setError('');
    try {
      const res = await fetch(report.endpoint);
      if (!res.ok) throw new Error('Failed to load report');
      const json = await res.json();
      const raw = json.data?.data ?? json.data ?? json;
      setReportData(Array.isArray(raw) ? raw : [raw]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading report');
      setReportData([]);
    } finally { setLoading(false); }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Westsides Reports" subtitle="Sales, inventory, batch, customer, and profitability reports" />

      {/* Report Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {REPORTS.map((report) => (
          <button
            key={report.key}
            onClick={() => loadReport(report)}
            className={`text-left p-4 rounded-xl border transition-all ${report.color} ${activeReport?.key === report.key ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}`}
          >
            <div className="text-2xl mb-2">{report.icon}</div>
            <div className="text-sm font-semibold text-slate-800 mb-1">{report.title}</div>
            <div className="text-xs text-slate-500 leading-snug">{report.description}</div>
          </button>
        ))}
      </div>

      {/* Report Results */}
      {activeReport && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-800">{activeReport.icon} {activeReport.title}</div>
              <div className="text-xs text-slate-500 mt-0.5">{activeReport.description}</div>
            </div>
            <button
              onClick={() => loadReport(activeReport)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium border border-indigo-200 rounded px-3 py-1.5 hover:bg-indigo-50"
            >
              ↻ Refresh
            </button>
          </div>

          {error && (
            <div className="mx-5 my-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {loading ? <Spinner /> : <ReportTable data={reportData} />}
        </Card>
      )}

      {!activeReport && (
        <div className="text-center py-12 text-sm text-slate-400">
          Click a report card above to load and view the data.
        </div>
      )}
    </div>
  );
}
