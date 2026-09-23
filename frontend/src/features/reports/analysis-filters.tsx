'use client';
import { useState } from 'react';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import { localToday, type Directory } from '@/features/invoice-desk/types';
import type { AnalysisFilters } from './analysis-types';
export function useAnalysisFilters(view: string) {
  const params = useSearchParams(),
    router = useGuardedRouter(),
    today = localToday();
  const filters: AnalysisFilters = {
    companyId: params.get('companyId') || '',
    divisionId: params.get('divisionId') || '',
    branchId: params.get('branchId') || '',
    partyId: ['customers', 'suppliers', 'sales', 'purchases'].includes(view)
      ? params.get('partyId') || ''
      : '',
    currency: params.get('currency') || '',
    from: params.get('from') || `${today.slice(0, 7)}-01`,
    to: params.get('to') || today,
  };
  const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
  const href = (target: string, patch: Partial<AnalysisFilters> = {}, tab?: string) => {
    const p = new URLSearchParams(
      Object.fromEntries(Object.entries({ ...filters, ...patch }).filter(([, v]) => v)),
    );
    if (target) p.set('view', target);
    if (tab) p.set('tab', tab);
    return `/reports?${p}`;
  };
  return {
    filters,
    query,
    tab: params.get('tab') || '',
    href,
    apply: (next: Partial<AnalysisFilters>, tab?: string) => router.push(href(view, next, tab)),
  };
}
export function AnalysisFilterForm({
  value,
  directory,
  onApply,
  parties,
  partyLabel,
}: {
  value: AnalysisFilters;
  directory: Directory | null;
  onApply: (value: AnalysisFilters) => void;
  parties?: { id: string; name: string }[];
  partyLabel?: string;
}) {
  const [draft, setDraft] = useState(value),
    [error, setError] = useState('');
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const dates = [draft.from, draft.to];
    if (
      dates.some(
        (d) =>
          !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
          !Number.isFinite(new Date(d).getTime()) ||
          new Date(d).toISOString().slice(0, 10) !== d,
      ) ||
      draft.from > draft.to
    ) {
      setError('Enter valid dates (YYYY-MM-DD), with the start before the end.');
      return;
    }
    setError('');
    onApply(draft);
  }
  function preset(type: string) {
    const now = localToday(),
      date = new Date(`${now}T00:00:00Z`);
    let from = now,
      to = now;
    if (type === 'month') from = `${now.slice(0, 7)}-01`;
    if (type === 'year') from = `${now.slice(0, 4)}-01-01`;
    if (type === 'last') {
      const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0));
      to = end.toISOString().slice(0, 10);
      from = `${to.slice(0, 7)}-01`;
    }
    setDraft((d) => ({ ...d, from, to }));
  }
  return (
    <form onSubmit={submit} className="analysis-filter-form">
      <div className="reports-filters">
        {(['companyId', 'divisionId', 'branchId'] as const).map((key, i) => {
          const list =
            i === 0
              ? directory?.companies
              : i === 1
                ? directory?.divisions.filter(
                    (d) => !draft.companyId || d.companyId === draft.companyId,
                  )
                : directory?.branches.filter(
                    (b) =>
                      (!draft.companyId || b.companyId === draft.companyId) &&
                      (!draft.divisionId || b.divisionId === draft.divisionId),
                  );
          return (
            <label key={key}>
              {['Company', 'Division', 'Branch'][i]}
              <select
                value={draft[key]}
                disabled={!directory}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    [key]: e.target.value,
                    ...(i === 0
                      ? { divisionId: '', branchId: '', partyId: '' }
                      : i === 1
                        ? { branchId: '' }
                        : {}),
                  }))
                }
              >
                <option value="">All accessible {['companies', 'divisions', 'branches'][i]}</option>
                {list?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <label>
          From
          <input
            placeholder="YYYY-MM-DD"
            aria-label="From"
            value={draft.from}
            maxLength={10}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          />
        </label>
        <label>
          To
          <input
            placeholder="YYYY-MM-DD"
            aria-label="To"
            value={draft.to}
            maxLength={10}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          />
        </label>
        <label>
          Currency
          <select
            value={draft.currency}
            onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}
          >
            <option value="">All currencies, separately</option>
            {['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {partyLabel && (
          <label>
            {partyLabel}
            <select
              value={draft.partyId}
              disabled={draft.companyId !== value.companyId}
              onChange={(e) => setDraft((d) => ({ ...d, partyId: e.target.value }))}
            >
              <option value="">All {partyLabel.toLowerCase()}s</option>
              {parties?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="analysis-filter-actions">
        <div className="reports-date-shortcuts">
          <button type="button" onClick={() => preset('month')}>
            This month
          </button>
          <button type="button" onClick={() => preset('last')}>
            Last month
          </button>
          <button type="button" onClick={() => preset('year')}>
            This year
          </button>
        </div>
        <button type="submit" className="reports-export">
          Apply filters
        </button>
      </div>
      {error && (
        <p className="reports-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
export function FilterCaption({
  filters,
  directory,
}: {
  filters: AnalysisFilters;
  directory: Directory | null;
}) {
  return (
    <p className="reports-scope-summary">
      {directory?.companies.find((c) => c.id === filters.companyId)?.name ||
        'All accessible companies'}{' '}
      ·{' '}
      {directory?.divisions.find((d) => d.id === filters.divisionId)?.name ||
        'All accessible divisions'}{' '}
      ·{' '}
      {directory?.branches.find((b) => b.id === filters.branchId)?.name ||
        'All accessible branches'}{' '}
      · {filters.from} to {filters.to} · {filters.currency || 'Currencies shown separately'}
    </p>
  );
}
