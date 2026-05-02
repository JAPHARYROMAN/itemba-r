'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface AutomationSummary {
  activeRules: number;
  runsToday: number;
  failedRunsLast7Days: number;
  totalRules?: number;
  inactiveRules?: number;
  pausedRules?: number;
  errorRules?: number;
  rulesDue?: number;
  recentRuns?: number;
  successfulRuns?: number;
  requestedRuns?: number;
  successRate?: number;
  failureRate?: number;
  throughput?: {
    recordsProcessed?: number;
    recordsCreated?: number;
    recordsFailed?: number;
  };
  latestFailedRuns?: Array<{
    id: string;
    automationRunNumber?: string;
    errorMessage?: string | null;
    createdAt?: string;
  }>;
  upcomingRules?: Array<{
    id: string;
    automationRuleCode?: string;
    name?: string;
    automationType?: string;
    triggerType?: string;
    nextRunAt?: string | null;
  }>;
}

export default function AutomationDashboardPage() {
  const [stats, setStats] = useState<AutomationSummary>({
    activeRules: 0,
    runsToday: 0,
    failedRunsLast7Days: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/business-automation/summary')
      .then((r) => r.json())
      .then((res) => {
        const d = res.data ?? res;
        setStats({
          ...d,
          activeRules: d.activeRules ?? 0,
          runsToday: d.runsToday ?? 0,
          failedRunsLast7Days: d.failedRunsLast7Days ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    {
      label: 'Active Rules',
      value: stats.activeRules,
      color: 'bg-green-50 text-green-700 border-green-200',
    },
    {
      label: 'Rules Run Today',
      value: stats.runsToday,
      color: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      label: 'Failed Runs (7d)',
      value: stats.failedRunsLast7Days,
      color: 'bg-red-50 text-red-700 border-red-200',
    },
    {
      label: 'Rules Due',
      value: stats.rulesDue ?? 0,
      color: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    {
      label: 'Success Rate',
      value: `${stats.successRate ?? 0}%`,
      color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    {
      label: 'Records Processed',
      value: stats.throughput?.recordsProcessed ?? 0,
      color: 'bg-slate-50 text-slate-700 border-slate-200',
    },
  ];

  const quickLinks = [
    {
      label: 'Automation Rules',
      href: '/automation/rules',
      desc: 'Configure business automation rules',
    },
    {
      label: 'Automation Runs',
      href: '/automation/runs',
      desc: 'Monitor automation execution history',
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Business Automation</h1>
        <p className="text-gray-500 mt-1">Business process automation overview</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            {statCards.map((card) => (
              <div key={card.label} className={`rounded-lg border p-4 ${card.color}`}>
                <div className="text-2xl font-bold">{card.value}</div>
                <div className="text-sm font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm text-gray-800">
                Upcoming Rules
              </div>
              <div className="divide-y divide-gray-100">
                {(stats.upcomingRules ?? []).slice(0, 5).map((rule) => (
                  <div key={rule.id} className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">
                      {rule.name ?? rule.automationRuleCode}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {rule.automationType ?? 'Automation'} | {rule.triggerType ?? 'Trigger'} |{' '}
                      {rule.nextRunAt ? new Date(rule.nextRunAt).toLocaleString() : 'Not scheduled'}
                    </div>
                  </div>
                ))}
                {(stats.upcomingRules ?? []).length === 0 && (
                  <div className="px-4 py-6 text-sm text-gray-500">No scheduled rules.</div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm text-gray-800">
                Recent Failures
              </div>
              <div className="divide-y divide-gray-100">
                {(stats.latestFailedRuns ?? []).slice(0, 5).map((run) => (
                  <div key={run.id} className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">
                      {run.automationRunNumber ?? run.id}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {run.errorMessage ?? 'No error message captured'}
                    </div>
                  </div>
                ))}
                {(stats.latestFailedRuns ?? []).length === 0 && (
                  <div className="px-4 py-6 text-sm text-gray-500">No failed runs found.</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow"
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
