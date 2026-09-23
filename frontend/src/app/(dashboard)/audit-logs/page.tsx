'use client';
import { FormDateField, Modal } from '@/components/ui';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';
import { backendGet, backendPage } from '@/lib/api-client';

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
  return (
    <Modal open title={log.action.replace(/_/g, ' ')} subtitle={new Date(log.createdAt).toLocaleString()} onClose={onClose} size="lg"><div className="os-legacy-dialog-content">


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
      </div></Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const SEVERITY_OPTIONS = ['', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default function AuditLogsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('audit-logs.read');
  const beginRequest = useRequestGuard();

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
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  useEffect(() => {
    if (authLoading || !canView) return;
    const controller = new AbortController();
    void backendPage<Company>('companies', { signal: controller.signal, query: { limit: 100 } })
      .then((page) => {
        if (!controller.signal.aborted) setCompanies(page.data);
      })
      .catch(() => undefined);
    void backendGet<string[]>('audit-logs/entity-types', { signal: controller.signal })
      .then((types) => {
        if (!controller.signal.aborted) setEntityTypes(Array.isArray(types) ? types : []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [authLoading, canView]);

  useEffect(() => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const logs = await backendPage<AuditLog>('audit-logs', {
          signal: request.signal,
          query: {
            search,
            companyId,
            action,
            entityType,
            severity,
            dateFrom,
            dateTo,
            page,
            limit: 50,
          },
        });
        if (!request.current()) return;
        setResult(logs);
      } catch (err) {
        if (!request.current()) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load audit logs');
      } finally {
        if (request.current()) setLoading(false);
      }
    })();
  }, [
    action,
    authLoading,
    beginRequest,
    canView,
    companyId,
    dateFrom,
    dateTo,
    entityType,
    page,
    retry,
    search,
    severity,
  ]);

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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Trail</h1>
        <p className="text-sm text-gray-500 mt-1">Loading</p>
      </div>
    );
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
          <input aria-label="Search action, entity, IP…"
            placeholder="Search action, entity, IP…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="col-span-1 md:col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
          <select aria-label="All Companies"
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
          <select aria-label="Severity"
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
          <select aria-label="All Entity Types"
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
          <input aria-label="Filter by action…"
            placeholder="Filter by action…"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <FormDateField
            aria-label="Date From"
            value={dateFrom}
            onChange={(value) => {
              setDateFrom(value);
              setPage(1);
            }}
            className="ui-date-field-inline"
          />
          <FormDateField
            aria-label="Date To"
            value={dateTo}
            onChange={(value) => {
              setDateTo(value);
              setPage(1);
            }}
            className="ui-date-field-inline"
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

      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2"
        >
          <span>{loadError}</span>
          <button
            type="button"
            className="font-medium text-red-700 hover:underline"
            onClick={() => setRetry((current) => current + 1)}
          >
            Try again
          </button>
        </div>
      )}

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
              <WorkspaceTable className="min-w-full divide-y divide-gray-100 text-sm">
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
              </WorkspaceTable>
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
