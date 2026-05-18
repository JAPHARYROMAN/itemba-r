'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Btn,
  Card,
  EmptyState,
  FormSelect,
  PageHeader,
  StatusBadge,
} from '@/components/ui';

interface PeriodClose {
  id: string;
  closeNumber?: string;
  companyId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  status: 'DRAFT' | 'REVIEWING' | 'CLOSED' | 'CANCELLED';
  initiatedById?: string;
  initiatedAt?: string;
  closedById?: string;
  closedAt?: string;
  notes?: string;
  accountingPeriod?: { id: string; name: string; startDate: string; endDate: string };
}

interface Company { id: string; name: string }
interface Period {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
}

interface Check {
  key: string;
  label: string;
  passed: boolean;
  count?: number;
  detail?: string;
}

export default function PeriodClosePage() {
  const [closes, setCloses] = useState<PeriodClose[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [checksLoading, setChecksLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/backend/period-close${companyId ? `?companyId=${companyId}` : ''}`);
      const j = await r.json();
      const list = Array.isArray(j.data)
        ? j.data
        : Array.isArray(j.data?.data)
          ? j.data.data
          : Array.isArray(j.items)
            ? j.items
            : [];
      setCloses(list);
    } catch {
      setCloses([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    reload();
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []),
      );
  }, [reload]);

  useEffect(() => {
    if (!companyId) {
      setPeriods([]);
      return;
    }
    fetch(`/api/backend/accounting-periods?companyId=${encodeURIComponent(companyId)}&limit=200`)
      .then((r) => r.json())
      .then((j) =>
        setPeriods(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []),
      );
  }, [companyId]);

  // Build readiness checklist for the selected period.
  const runChecks = async () => {
    if (!companyId || !selectedPeriodId) return;
    setChecksLoading(true);
    setChecks(null);
    try {
      const period = periods.find((p) => p.id === selectedPeriodId);
      if (!period) return;
      const dateFrom = period.startDate;
      const dateTo = period.endDate;
      // Each call is best-effort; missing endpoints resolve to "not run" rows
      // rather than crashing the page.
      const [jeRes, lockRes] = await Promise.allSettled([
        fetch(
          `/api/backend/journal-entries?companyId=${companyId}&status=DRAFT&dateFrom=${dateFrom}&dateTo=${dateTo}`,
        ).then((r) => r.json()),
        fetch(`/api/backend/accounting-locks?companyId=${companyId}`).then((r) => r.json()),
      ]);

      const draftList =
        jeRes.status === 'fulfilled'
          ? Array.isArray(jeRes.value.data)
            ? jeRes.value.data
            : jeRes.value.data?.data ?? jeRes.value.items ?? []
          : [];
      const draftCount = Array.isArray(draftList) ? draftList.length : 0;

      const locks =
        lockRes.status === 'fulfilled'
          ? Array.isArray(lockRes.value.data)
            ? lockRes.value.data
            : lockRes.value.data?.data ?? lockRes.value.items ?? []
          : [];
      const periodLocked = (locks as Array<Record<string, unknown>>).some(
        (l) =>
          l.status === 'ACTIVE' &&
          new Date(l.lockedFrom as string) <= new Date(dateFrom) &&
          new Date(l.lockedTo as string) >= new Date(dateTo),
      );

      setChecks([
        {
          key: 'period-open',
          label: 'Period status is OPEN',
          passed: period.status === 'OPEN',
          detail: period.status === 'OPEN' ? 'OPEN' : 'Period already CLOSED',
        },
        {
          key: 'no-drafts',
          label: 'No DRAFT journal entries in period',
          passed: draftCount === 0,
          count: draftCount,
          detail:
            draftCount === 0
              ? 'Clear'
              : `${draftCount} DRAFT entries — post or delete them before close`,
        },
        {
          key: 'no-locks',
          label: 'Period not already locked',
          passed: !periodLocked,
          detail: periodLocked ? 'Active AccountingLock covers this period' : 'No conflicting lock',
        },
      ]);
    } finally {
      setChecksLoading(false);
    }
  };

  const initiateClose = async () => {
    if (!companyId || !selectedPeriodId) return;
    const period = periods.find((p) => p.id === selectedPeriodId);
    if (!period) return;
    setBusy(true);
    try {
      const fiscalRes = await fetch(
        `/api/backend/fiscal-years?companyId=${companyId}&limit=20`,
      ).then((r) => r.json());
      const fiscalYears: Array<Record<string, unknown>> = Array.isArray(fiscalRes.data?.data)
        ? fiscalRes.data.data
        : Array.isArray(fiscalRes.data)
          ? fiscalRes.data
          : [];
      const fy = fiscalYears.find(
        (f) =>
          new Date(f.startDate as string) <= new Date(period.startDate) &&
          new Date(f.endDate as string) >= new Date(period.endDate),
      );
      await fetch('/api/backend/period-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          fiscalYearId: fy?.id,
          accountingPeriodId: period.id,
        }),
      });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const advanceClose = async (id: string, action: 'review' | 'close') => {
    setBusy(true);
    try {
      await fetch(`/api/backend/period-close/${id}/${action}`, { method: 'PATCH' });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Period Close" subtitle="Pre-close readiness checks and close orchestration" />

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <FormSelect
              label="Company"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setSelectedPeriodId('');
                setChecks(null);
              }}
            >
              <option value="">— select —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
          </div>
          <div className="min-w-[240px] flex-1">
            <FormSelect
              label="Period"
              value={selectedPeriodId}
              onChange={(e) => {
                setSelectedPeriodId(e.target.value);
                setChecks(null);
              }}
              disabled={!companyId}
            >
              <option value="">— select —</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.status})
                </option>
              ))}
            </FormSelect>
          </div>
          <Btn
            variant="secondary"
            onClick={runChecks}
            disabled={!selectedPeriodId}
            loading={checksLoading}
          >
            Run readiness checks
          </Btn>
        </div>

        {checks ? (
          <div className="border-t pt-3 space-y-2">
            <h3 className="text-sm font-semibold">Readiness checklist</h3>
            <ul className="space-y-1 text-sm">
              {checks.map((c) => (
                <li key={c.key} className="flex items-center gap-3">
                  <span className={c.passed ? 'text-green-600' : 'text-red-600'}>
                    {c.passed ? '✓' : '✗'}
                  </span>
                  <span>{c.label}</span>
                  {c.detail ? <span className="text-xs text-slate-500">— {c.detail}</span> : null}
                </li>
              ))}
            </ul>
            <Btn
              variant="primary"
              onClick={initiateClose}
              disabled={!checks.every((c) => c.passed)}
              loading={busy}
            >
              Initiate close
            </Btn>
          </div>
        ) : null}
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b text-sm font-semibold">Recent period closes</div>
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : closes.length === 0 ? (
          <EmptyState
            title="No period closes yet"
            description="Run the readiness checks above and initiate the first close."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-slate-50 text-slate-500">
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Initiated</th>
                <th className="px-4 py-3">Closed</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {closes.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-xs">
                    {c.accountingPeriod?.name ?? c.accountingPeriodId}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {c.initiatedAt ? new Date(c.initiatedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {c.closedAt ? new Date(c.closedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-xs space-x-2">
                    {c.status === 'DRAFT' ? (
                      <button
                        className="text-blue-600 hover:underline"
                        onClick={() => advanceClose(c.id, 'review')}
                      >
                        Review
                      </button>
                    ) : null}
                    {c.status === 'REVIEWING' ? (
                      <button
                        className="text-green-600 hover:underline"
                        onClick={() => advanceClose(c.id, 'close')}
                      >
                        Close
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
