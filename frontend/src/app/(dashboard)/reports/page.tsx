'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

type ReportSector =
  | 'FINANCE'
  | 'HR'
  | 'OPERATIONS'
  | 'PETROLEUM'
  | 'WESTSIDES'
  | 'COMPLIANCE'
  | 'ITEMBA'
  | 'AGRICULTURE'
  | 'CONSTRUCTION'
  | 'LOGISTICS'
  | 'BI';
type ReportScope = 'GROUP' | 'COMPANY' | 'DIVISION';

interface CatalogEntry {
  id: string;
  sector: ReportSector;
  category: string;
  name: string;
  description: string;
  scopes: ReportScope[];
  permission: string;
  apiPath: string;
  frontendPath: string;
}

interface CatalogResponse {
  total: number;
  filtered: number;
  sectors: ReportSector[];
  sectorCounts: Record<string, number>;
  entries: CatalogEntry[];
}

interface Company { id: string; name: string; code: string; }
interface Division { id: string; name: string; code: string; companyId: string; }

const SECTOR_META: Record<ReportSector, { label: string; color: string; icon: string }> = {
  FINANCE: { label: 'Finance', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '◈' },
  HR: { label: 'HR & Payroll', color: 'bg-violet-50 text-violet-700 border-violet-200', icon: '◉' },
  OPERATIONS: { label: 'Operations', color: 'bg-sky-50 text-sky-700 border-sky-200', icon: '◐' },
  PETROLEUM: { label: 'Petroleum', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: '◆' },
  WESTSIDES: { label: 'Westsides', color: 'bg-rose-50 text-rose-700 border-rose-200', icon: '◇' },
  COMPLIANCE: { label: 'Compliance', color: 'bg-zinc-100 text-zinc-700 border-zinc-200', icon: '✓' },
  ITEMBA: { label: 'Itemba', color: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: '◢' },
  AGRICULTURE: { label: 'Agriculture', color: 'bg-lime-50 text-lime-700 border-lime-200', icon: '✿' },
  CONSTRUCTION: { label: 'Construction', color: 'bg-orange-50 text-orange-700 border-orange-200', icon: '▣' },
  LOGISTICS: { label: 'Logistics', color: 'bg-teal-50 text-teal-700 border-teal-200', icon: '➤' },
  BI: { label: 'BI / Advanced', color: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200', icon: '◭' },
};

const SCOPE_META: Record<ReportScope, { label: string; color: string }> = {
  GROUP: { label: 'Group', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  COMPANY: { label: 'Company', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  DIVISION: { label: 'Division', color: 'bg-violet-50 text-violet-700 border-violet-200' },
};

export default function MasterReportsPage() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [scope, setScope] = useState<ReportScope>('COMPANY');
  const [sector, setSector] = useState<ReportSector | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');

  // Load companies once.
  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Company[] = Array.isArray(inner) ? inner : Array.isArray(inner?.data) ? inner.data : [];
        setCompanies(rows);
      })
      .catch(() => {});
  }, []);

  // Load divisions when company changes.
  useEffect(() => {
    if (!companyId) { setDivisions([]); setDivisionId(''); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=50`)
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Division[] = Array.isArray(inner) ? inner : Array.isArray(inner?.data) ? inner.data : [];
        setDivisions(rows);
      })
      .catch(() => {});
    setDivisionId('');
  }, [companyId]);

  // Load catalog (re-fetches when scope/sector change).
  const loadCatalog = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      params.set('scope', scope);
      if (sector !== 'ALL') params.set('sector', sector);
      const res = await fetch(`/api/backend/reports/catalog?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data: CatalogResponse = json.data ?? json;
      setCatalog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, [scope, sector]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const filteredEntries = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    if (!q) return catalog.entries;
    return catalog.entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q),
    );
  }, [catalog, search]);

  // Group filtered entries by sector → category for the grid.
  const grouped = useMemo(() => {
    const bySector = new Map<ReportSector, Map<string, CatalogEntry[]>>();
    for (const e of filteredEntries) {
      let cat = bySector.get(e.sector);
      if (!cat) { cat = new Map(); bySector.set(e.sector, cat); }
      const list = cat.get(e.category) ?? [];
      list.push(e);
      cat.set(e.category, list);
    }
    return bySector;
  }, [filteredEntries]);

  const buildLink = (entry: CatalogEntry) => {
    // Per-record reports (apiPath has {id}) can't be auto-run — link to the
    // sector page so the user can pick a record. Everything else opens in
    // the generic runner with parameters pre-applied.
    const isPerRecord = entry.apiPath.includes('{id}');
    if (isPerRecord) {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      if (divisionId) params.set('divisionId', divisionId);
      params.set('reportId', entry.id);
      const qs = params.toString();
      return qs ? `${entry.frontendPath}?${qs}` : entry.frontendPath;
    }
    const params = new URLSearchParams();
    params.set('reportId', entry.id);
    if (companyId) params.set('companyId', companyId);
    if (divisionId) params.set('divisionId', divisionId);
    return `/reports/run?${params.toString()}`;
  };

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Master catalog — every report across every sector. Pick a scope, pick a sector, drill in."
      />

      {/* Scope strip */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">Scope</div>
            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
              {(['GROUP', 'COMPANY', 'DIVISION'] as ReportScope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1.5 text-xs font-medium border-r border-slate-200 last:border-r-0 transition ${
                    scope === s ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {SCOPE_META[s].label}
                </button>
              ))}
            </div>
          </div>

          {(scope === 'COMPANY' || scope === 'DIVISION') && (
            <div>
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">Company</div>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">— Select Company —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {scope === 'DIVISION' && companyId && (
            <div>
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">Division</div>
              <select
                value={divisionId}
                onChange={(e) => setDivisionId(e.target.value)}
                className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">— Select Division —</option>
                {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}

          <div className="flex-1 min-w-[200px]">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">Search</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="trial balance, sales, leave…"
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        </div>
      </Card>

      {/* Sector tabs */}
      {catalog && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSector('ALL')}
            className={`px-3 py-1.5 text-xs font-medium border rounded-full transition ${
              sector === 'ALL' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All <span className="ml-1 opacity-70">{catalog.total}</span>
          </button>
          {catalog.sectors.map((s) => (
            <button
              key={s}
              onClick={() => setSector(s)}
              className={`px-3 py-1.5 text-xs font-medium border rounded-full transition ${
                sector === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {SECTOR_META[s].icon} {SECTOR_META[s].label} <span className="ml-1 opacity-70">{catalog.sectorCounts[s] ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}

      {!loading && filteredEntries.length === 0 && (
        <Card className="p-10 text-center text-sm text-slate-500">No reports match the current filters.</Card>
      )}

      {/* Grid grouped by sector → category */}
      {!loading && Array.from(grouped.entries()).map(([sec, byCategory]) => (
        <Card key={sec} className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center px-2 py-0.5 border rounded-full text-[11px] font-semibold ${SECTOR_META[sec].color}`}>
                {SECTOR_META[sec].icon} {SECTOR_META[sec].label}
              </span>
              <span className="text-xs text-slate-500">
                {Array.from(byCategory.values()).reduce((s, list) => s + list.length, 0)} reports
              </span>
            </div>
          </div>
          <div className="p-4 space-y-5">
            {Array.from(byCategory.entries()).map(([category, entries]) => (
              <div key={category}>
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">{category}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {entries.map((entry) => (
                    <a
                      key={entry.id}
                      href={buildLink(entry)}
                      className="block border border-slate-200 rounded-lg p-3 hover:border-indigo-300 hover:bg-indigo-50/40 transition group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="font-medium text-sm text-slate-800 group-hover:text-indigo-700">{entry.name}</div>
                        <div className="flex flex-wrap gap-1 flex-shrink-0">
                          {entry.scopes.map((sc) => (
                            <span key={sc} className={`inline-flex items-center px-1.5 py-0.5 border rounded text-[10px] font-medium ${SCOPE_META[sc].color}`}>
                              {SCOPE_META[sc].label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 leading-snug">{entry.description}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-2">{entry.id}</div>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
