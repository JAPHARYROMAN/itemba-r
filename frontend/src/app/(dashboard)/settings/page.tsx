'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppIcon, type AppIconName, Card, PageHeader, SkeletonCardGrid, showToast } from '@/components/ui';

type SettingCategory =
  | 'ORGANIZATION'
  | 'USERS_ACCESS'
  | 'ACCOUNTING'
  | 'HR'
  | 'COMPLIANCE'
  | 'OPERATIONS'
  | 'TEMPLATES'
  | 'NOTIFICATIONS'
  | 'INTEGRATIONS'
  | 'APPROVALS'
  | 'LOCALIZATION'
  | 'PREFERENCES'
  | 'SYSTEM';
type SettingScope = 'GROUP' | 'COMPANY' | 'USER';
type SettingStatus = 'BUILT_IN' | 'PLANNED';

interface SettingEntry {
  id: string;
  category: SettingCategory;
  name: string;
  description: string;
  href: string;
  permission?: string;
  scope: SettingScope;
  status: SettingStatus;
}

interface CatalogResponse {
  total: number;
  filtered: number;
  categories: SettingCategory[];
  categoryCounts: Record<string, number>;
  entries: SettingEntry[];
}

const CATEGORY_META: Record<SettingCategory, { label: string; color: string; icon: AppIconName }> = {
  ORGANIZATION: { label: 'Organization', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'company' },
  USERS_ACCESS: { label: 'Users & Access', color: 'bg-violet-50 text-violet-700 border-violet-200', icon: 'customers' },
  ACCOUNTING: { label: 'Accounting', color: 'bg-sky-50 text-sky-700 border-sky-200', icon: 'finance' },
  HR: { label: 'HR', color: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200', icon: 'hr' },
  COMPLIANCE: { label: 'Compliance & Tax', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'tax' },
  OPERATIONS: { label: 'Operations Catalog', color: 'bg-teal-50 text-teal-700 border-teal-200', icon: 'inventory' },
  TEMPLATES: { label: 'Templates', color: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'document' },
  NOTIFICATIONS: { label: 'Notifications', color: 'bg-orange-50 text-orange-700 border-orange-200', icon: 'bell' },
  INTEGRATIONS: { label: 'Integrations', color: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: 'transfer' },
  APPROVALS: { label: 'Approvals', color: 'bg-lime-50 text-lime-700 border-lime-200', icon: 'approved' },
  LOCALIZATION: { label: 'Localization', color: 'bg-cyan-50 text-cyan-700 border-cyan-200', icon: 'settings' },
  PREFERENCES: { label: 'My Preferences', color: 'bg-zinc-100 text-zinc-700 border-zinc-200', icon: 'settings' },
  SYSTEM: { label: 'System', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: 'settings' },
};

const SCOPE_META: Record<SettingScope, { label: string; color: string }> = {
  GROUP: { label: 'Group', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  COMPANY: { label: 'Company', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  USER: { label: 'User', color: 'bg-zinc-100 text-zinc-700 border-zinc-200' },
};

export default function MasterSettingsPage() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [scope, setScope] = useState<SettingScope | 'ALL'>('ALL');
  const [category, setCategory] = useState<SettingCategory | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [hidePlanned, setHidePlanned] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (scope !== 'ALL') params.set('scope', scope);
      if (category !== 'ALL') params.set('category', category);
      const res = await fetch(`/api/backend/settings/catalog?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data: CatalogResponse = json.data ?? json;
      setCatalog(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load catalog';
      setError(message);
      showToast('error', 'Settings catalog unavailable', message);
    } finally {
      setLoading(false);
    }
  }, [scope, category]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const filteredEntries = useMemo(() => {
    if (!catalog) return [];
    let list = catalog.entries;
    if (hidePlanned) list = list.filter((e) => e.status !== 'PLANNED');
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    );
  }, [catalog, search, hidePlanned]);

  // Group filtered entries by category for the grid.
  const grouped = useMemo(() => {
    const byCategory = new Map<SettingCategory, SettingEntry[]>();
    for (const e of filteredEntries) {
      const list = byCategory.get(e.category) ?? [];
      list.push(e);
      byCategory.set(e.category, list);
    }
    return byCategory;
  }, [filteredEntries]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Configure organization, users, accounting, HR, integrations, and system behaviour."
      />

      {/* Filter strip */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">Scope</div>
            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
              {(['ALL', 'GROUP', 'COMPANY', 'USER'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1.5 text-xs font-medium border-r border-slate-200 last:border-r-0 transition ${
                    scope === s ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {s === 'ALL' ? 'All' : SCOPE_META[s as SettingScope].label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-[200px]">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">Search</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="users, roles, tax, leave…"
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-600 select-none">
            <input
              type="checkbox"
              checked={hidePlanned}
              onChange={(e) => setHidePlanned(e.target.checked)}
              className="rounded border-slate-300"
            />
            Hide planned
          </label>
        </div>
      </Card>

      {/* Category tabs */}
      {catalog && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategory('ALL')}
            className={`px-3 py-1.5 text-xs font-medium border rounded-full transition ${
              category === 'ALL' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All <span className="ml-1 opacity-70">{catalog.total}</span>
          </button>
          {catalog.categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1.5 text-xs font-medium border rounded-full transition ${
                category === c ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <AppIcon name={CATEGORY_META[c].icon} size={13} />
                {CATEGORY_META[c].label}
                <span className="ml-1 opacity-70">{catalog.categoryCounts[c] ?? 0}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <SkeletonCardGrid count={6} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" />}

      {!loading && filteredEntries.length === 0 && (
        <Card className="p-10 text-center text-sm text-slate-500">No settings match the current filters.</Card>
      )}

      {/* Grid grouped by category */}
      {!loading && Array.from(grouped.entries()).map(([cat, entries]) => (
        <Card key={cat} className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 border rounded-full text-[11px] font-semibold ${CATEGORY_META[cat].color}`}>
                <AppIcon name={CATEGORY_META[cat].icon} size={12} />
                {CATEGORY_META[cat].label}
              </span>
              <span className="text-xs text-slate-500">
                {entries.length} setting{entries.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <div className="aurora-stagger grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {entries.map((entry) => {
              const planned = entry.status === 'PLANNED';
              return (
                <a
                  key={entry.id}
                  href={planned ? '#' : entry.href}
                  onClick={(e) => { if (planned) e.preventDefault(); }}
                  className={`block border rounded-lg p-3 transition group ${
                    planned
                      ? 'border-dashed border-slate-200 bg-slate-50/50 cursor-not-allowed opacity-70'
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className={`font-medium text-sm ${planned ? 'text-slate-600' : 'text-slate-800 group-hover:text-indigo-700'}`}>
                      {entry.name}
                    </div>
                    <div className="flex flex-wrap gap-1 flex-shrink-0">
                      <span className={`inline-flex items-center px-1.5 py-0.5 border rounded text-[10px] font-medium ${SCOPE_META[entry.scope].color}`}>
                        {SCOPE_META[entry.scope].label}
                      </span>
                      {planned && (
                        <span className="inline-flex items-center px-1.5 py-0.5 border rounded text-[10px] font-medium bg-amber-50 text-amber-700 border-amber-200">
                          Planned
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 leading-snug">{entry.description}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-2">{entry.href}</div>
                </a>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
