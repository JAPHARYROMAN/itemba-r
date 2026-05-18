'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface AccountingEngineSummary {
  pendingPostingRuns: number;
  openAccountingLocks: number;
  pendingPeriodCloses: number;
  pendingAuditAdjustments: number;
}

export default function AccountingEngineDashboardPage() {
  const [stats, setStats] = useState<AccountingEngineSummary>({
    pendingPostingRuns: 0,
    openAccountingLocks: 0,
    pendingPeriodCloses: 0,
    pendingAuditAdjustments: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/accounting-engine/summary')
      .then((r) => r.json())
      .then((res) => {
        const d = res.data ?? res;
        setStats({
          pendingPostingRuns: d.pendingPostingRuns ?? 0,
          openAccountingLocks: d.openAccountingLocks ?? 0,
          pendingPeriodCloses: d.pendingPeriodCloses ?? 0,
          pendingAuditAdjustments: d.pendingAuditAdjustments ?? 0,
        });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load accounting summary');
      })
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    {
      label: 'Pending Posting Runs',
      value: stats.pendingPostingRuns,
      color: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      label: 'Open Accounting Locks',
      value: stats.openAccountingLocks,
      color: 'bg-red-50 text-red-700 border-red-200',
    },
    {
      label: 'Pending Period Closes',
      value: stats.pendingPeriodCloses,
      color: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    },
    {
      label: 'Pending Audit Adjustments',
      value: stats.pendingAuditAdjustments,
      color: 'bg-purple-50 text-purple-700 border-purple-200',
    },
  ];

  const quickLinks = [
    {
      label: 'Posting Rules',
      href: '/accounting-engine/posting-rules',
      desc: 'Configure journal posting rules',
    },
    {
      label: 'Posting Runs',
      href: '/accounting-engine/posting-runs',
      desc: 'View and manage posting runs',
    },
    {
      label: 'Period Close',
      href: '/accounting-engine/period-close',
      desc: 'Manage period close processes',
    },
    {
      label: 'Accounting Locks',
      href: '/accounting-engine/accounting-locks',
      desc: 'Manage accounting period locks',
    },
    {
      label: 'Bank Reconciliations',
      href: '/accounting-engine/bank-reconciliations',
      desc: 'Reconcile bank statements',
    },
    {
      label: 'Depreciation Schedules',
      href: '/accounting-engine/depreciation',
      desc: 'Asset depreciation schedules',
    },
    {
      label: 'Loan Repayments',
      href: '/accounting-engine/loan-repayments',
      desc: 'Loan repayment schedules',
    },
    {
      label: 'Financial Statements',
      href: '/accounting-engine/financial-statements',
      desc: 'Generate financial statements',
    },
    {
      label: 'Audit Adjustments',
      href: '/accounting-engine/audit-adjustments',
      desc: 'Review audit adjustments',
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Accounting Engine</h1>
        <p className="text-gray-500 mt-1">Advanced accounting automation and processing overview</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map((card) => (
              <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
                <div className="text-3xl font-bold">{card.value}</div>
                <div className="text-sm font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
                <div className="font-semibold text-gray-900 mb-1">{link.label}</div>
                <div className="text-sm text-gray-500">{link.desc}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
