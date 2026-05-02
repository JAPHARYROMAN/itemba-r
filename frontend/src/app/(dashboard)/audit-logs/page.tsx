'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditUser {
  id: string;
  fullName: string;
  email: string;
}

interface AuditCompany {
  id: string;
  name: string;
  code: string;
}

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
  companyId: string | null;
  oldValue: unknown;
  newValue: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  createdAt: string;
  user?: AuditUser;
  company?: AuditCompany;
}

interface Company {
  id: string;
  name: string;
}

interface PagedResult {
  data: AuditLog[];
  total: number;
  page: number;
  totalPages: number;
}

// ─── Severity helpers ─────────────────────────────────────────────────────────

function severityBadge(sev: string) {
  const map: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-800 ring-red-300',
    HIGH: 'bg-orange-100 text-orange-800 ring-orange-300',
    MEDIUM: 'bg-yellow-100 text-yellow-700 ring-yellow-300',
    LOW: 'bg-gray-100 text-gray-600 ring-gray-300',
  };
  return (
    (map[sev] ?? map.LOW) +
    ' inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ring-1 ring-inset'
  );
}

function rowAccent(sev: string) {
  if (sev === 'CRITICAL') return 'bg-red-50 border-l-4 border-red-500';
  if (sev === 'HIGH') return 'bg-orange-50 border-l-4 border-orange-400';
  return '';
}

// ─── JSON diff viewer ─────────────────────────────────────────────────────────

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <pre className="bg-gray-900 text-green-300 text-xs rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function DetailModal({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  const headerCls =
    log.severity === 'CRITICAL'
      ? 'bg-red-600'
      : log.severity === 'HIGH'
        ? 'bg-orange-500'
        : log.severity === 'MEDIUM'
          ? 'bg-yellow-400'
          : 'bg-gray-200';
  const textCls =
    log.severity === 'LOW' || log.severity === 'MEDIUM' ? 'text-gray-800' : 'text-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className={`px-6 py-4 rounded-t-xl flex items-center justify-between ${headerCls}`}>
          <div>
            <h2 className={`text-lg font-bold ${textCls}`}>{log.action.replace(/_/g, ' ')}</h2>
            <p
              className={`text-xs ${log.severity === 'LOW' || log.severity === 'MEDIUM' ? 'text-gray-600' : 'text-white/80'}`}
            >
              Audit Log — {new Date(log.createdAt).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className={`${textCls} text-2xl font-light leading-none opacity-70 hover:opacity-100`}
          >
            &times;
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {[
              ['Event ID', log.id],
              [
                'Severity',
                <span key="s" className={severityBadge(log.severity)}>
                  {log.severity}
                </span>,
              ],
              ['Entity Type', log.entityType],
              ['Entity ID', log.entityId ?? '—'],
              ['User', log.user ? `${log.user.fullName} (${log.user.email})` : (log.userId ?? '—')],
              ['Company', log.company ? log.company.name : (log.companyId ?? '—')],
              ['IP Address', log.ipAddress ?? '—'],
              ['Timestamp', new Date(log.createdAt).toLocaleString()],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <p className="text-xs text-gray-500 font-medium">{k}</p>
                <p className="text-gray-900 break-all">{v as React.ReactNode}</p>
              </div>
            ))}
          </div>

          {log.userAgent && (
            <div>
              <p className="text-xs text-gray-500 font-medium">User Agent</p>
              <p className="text-xs text-gray-700 break-all">{log.userAgent}</p>
            </div>
          )}

          <div className="space-y-3">
            <JsonBlock label="Before (Old Value)" value={log.oldValue} />
            <JsonBlock label="After (New Value)" value={log.newValue} />
            <JsonBlock label="Metadata" value={log.metadata} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const SEVERITY_OPTIONS = ['', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default function AuditLogsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('audit-logs.read');

  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [severity, setSeverity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<PagedResult | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  async function apiFetch(path: string) {
    const res = await fetch(`/api/backend/${path}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { data: unknown };
    return json.data;
  }

  useEffect(() => {
    if (!canView) return;
    void apiFetch('companies?limit=100').then((d) => {
      if (d) setCompanies((d as { data: Company[] }).data ?? []);
    });
    void apiFetch('audit-logs/entity-types').then((d) => {
      if (d) setEntityTypes(d as string[]);
    });
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (companyId) params.set('companyId', companyId);
    if (action) params.set('action', action);
    if (entityType) params.set('entityType', entityType);
    if (severity) params.set('severity', severity);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    params.set('page', String(page));
    params.set('limit', '50');

    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/backend/audit-logs?${params.toString()}`, { signal });
        if (!res.ok) return;
        const json = (await res.json()) as { data: PagedResult };
        setResult(json.data);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    })();
  }, [search, companyId, action, entityType, severity, dateFrom, dateTo, page, canView]);

  function resetFilters() {
    setSearch('');
    setCompanyId('');
    setAction('');
    setEntityType('');
    setSeverity('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  if (!canView) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Trail</h1>
        <div className="mt-8 max-w-md mx-auto text-center bg-white border border-gray-200 rounded-lg p-8">
          <p className="text-lg font-semibold text-gray-900">Access Restricted</p>
          <p className="text-sm text-gray-500 mt-2">
            You don&rsquo;t have permission to view audit logs. Contact your administrator if you
            need access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Trail</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Immutable, append-only record of every action across the system.
          </p>
        </div>
        {result && (
          <div className="text-sm text-gray-500 bg-white border border-gray-200 px-4 py-2 rounded-lg">
            <span className="font-semibold text-gray-900">{result.total.toLocaleString()}</span>{' '}
            events
          </div>
        )}
      </div>

      {/* Severity legend */}
      <div className="flex gap-3 flex-wrap">
        {[
          { sev: 'CRITICAL', label: 'Critical — account lockouts, permission changes' },
          { sev: 'HIGH', label: 'High — logins, sensitive record access' },
          { sev: 'MEDIUM', label: 'Medium — creates, updates, uploads' },
          { sev: 'LOW', label: 'Low — views, lists, logouts' },
        ].map(({ sev, label }) => (
          <div key={sev} className="flex items-center gap-1.5">
            <span className={severityBadge(sev)}>{sev}</span>
            <span className="text-xs text-gray-500">{label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <input
            placeholder="Search action, entity, IP…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="col-span-1 md:col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="">All Companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || 'All Severities'}
              </option>
            ))}
          </select>
          <select
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="">All Entity Types</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            placeholder="Filter by action…"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={resetFilters}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Reset filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm animate-pulse">
            Loading audit events…
          </div>
        ) : !result || result.data.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">
            No audit events match your filters.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Timestamp', 'Severity', 'Action', 'Entity', 'User', 'Company', 'IP', ''].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.data.map((log) => (
                    <tr
                      key={log.id}
                      className={`${rowAccent(log.severity)} hover:bg-gray-50 transition-colors`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600 font-mono text-xs">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={severityBadge(log.severity)}>{log.severity}</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {log.action.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {log.entityType}
                        {log.entityId && (
                          <span className="ml-1 font-mono text-xs text-gray-400">
                            #{log.entityId.slice(0, 8)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {log.user ? (
                          <span title={log.user.email}>{log.user.fullName}</span>
                        ) : (
                          <span className="text-gray-400 italic">System</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{log.company?.name ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {log.ipAddress ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setSelected(log)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500">
                Page {result.page} of {result.totalPages} — {result.total.toLocaleString()} events
              </p>
              <div className="flex gap-2">
                <button
                  disabled={result.page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  disabled={result.page >= result.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {selected && <DetailModal log={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
