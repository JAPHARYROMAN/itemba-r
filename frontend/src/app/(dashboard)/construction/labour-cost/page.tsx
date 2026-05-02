'use client';

import { useEffect, useState } from 'react';
import { Btn, Card, FormInput, FormSelect, Modal, PageHeader, PageSpinner } from '@/components/ui';

interface Company { id: string; name: string; code: string }

interface EmployeeRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  days: number;
  gross: number;
  employerStatutory: number;
  totalCost: number;
}

interface ProjectRow {
  project: { id: string; projectCode: string; name: string; status: string } | null;
  projectId: string;
  employeeRows: EmployeeRow[];
  totals: { days: number; gross: number; employerStatutory: number; totalCost: number };
}

interface ReportPayload {
  period: { start: string; end: string };
  projects: ProjectRow[];
  totals: { totalAssigned: number; totalGross: number; totalEmployerStatutory: number; totalCost: number };
}

interface AllocationRow {
  id: string;
  days: number;
  allocatedGross: string | number;
  allocatedEmployerStatutory: string | number;
  allocatedTotalCost: string | number;
  currency: string;
  createdAt: string;
  employee?: { id: string; employeeCode: string; fullName: string };
  payrollRun?: { id: string; payrollRunNumber: string; paidAt: string | null };
}

interface AllocationsResponse {
  items: AllocationRow[];
  total: number;
  summary: { gross: number; employerStatutory: number; totalCost: number };
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function ConstructionLabourCostPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(monthStart);
  const [periodEnd, setPeriodEnd] = useState(monthEnd);
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [historyProject, setHistoryProject] = useState<{ id: string; name: string } | null>(null);
  const [historyData, setHistoryData] = useState<AllocationsResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const openHistory = async (project: ProjectRow) => {
    const projectId = project.projectId;
    const projectName = project.project?.name ?? projectId;
    setHistoryProject({ id: projectId, name: projectName });
    setHistoryData(null);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/backend/construction/labour-cost/projects/${projectId}/allocations`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Failed to load'));
      }
      const j = await res.json();
      setHistoryData(j.data ?? j);
    } catch (err: unknown) {
      setHistoryError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json())
      .then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setCompanies([]));
  }, []);

  const load = async () => {
    if (!companyId) { setError('Pick a company'); return; }
    setLoading(true); setError(''); setData(null);
    try {
      const params = new URLSearchParams({ companyId, periodStart, periodEnd });
      const res = await fetch(`/api/backend/construction/labour-cost/report?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Failed'));
      }
      const j = await res.json();
      setData(j.data ?? j);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleProject = (id: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Construction Labour Cost Allocation"
        subtitle="Per-project labour cost — gross pay + employer-side statutory, allocated by EmployeeAssignment days within the period."
        breadcrumbs={[{ label: 'Construction', href: '/construction' }, { label: 'Labour cost' }]}
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <FormSelect label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}
            options={companies.map(c => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            placeholder="Select company"
          />
          <FormInput label="Period start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          <FormInput label="Period end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          <div>
            <Btn variant="primary" onClick={load} loading={loading} disabled={!companyId}>Generate</Btn>
          </div>
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading && <PageSpinner />}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Active assignments" value={String(data.totals.totalAssigned)} />
            <Tile label="Total gross (TZS)" value={fmt(data.totals.totalGross)} />
            <Tile label="Employer statutory (TZS)" value={fmt(data.totals.totalEmployerStatutory)} />
            <Tile label="Total cost (TZS)" value={fmt(data.totals.totalCost)} highlight />
          </div>

          {data.projects.length === 0 ? (
            <Card className="p-10 text-center text-sm text-slate-400">
              No construction-project assignments overlap the selected period. Make sure employees are assigned with{' '}
              <code className="font-mono">assignmentContextType = CONSTRUCTION_PROJECT</code> on the Employee Assignments page.
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Project</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">Employees</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">Person-days</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">Gross (TZS)</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">Employer (TZS)</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">Total (TZS)</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide">History</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: 'var(--aurora-text)' }}>
                    {data.projects.map(p => (
                      <>
                        <tr key={p.projectId} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                          onClick={() => toggleProject(p.projectId)}>
                          <td className="px-4 py-2">
                            <div className="font-medium">{p.project?.name ?? p.projectId}</div>
                            <div className="text-xs font-mono text-slate-500">{p.project?.projectCode ?? '—'}</div>
                          </td>
                          <td className="px-4 py-2 text-xs">{p.project?.status ?? '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{p.employeeRows.length}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{p.totals.days}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt(p.totals.gross)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt(p.totals.employerStatutory)}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmt(p.totals.totalCost)}</td>
                          <td className="px-4 py-2 text-right">
                            <Btn variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); openHistory(p); }}>
                              History
                            </Btn>
                          </td>
                        </tr>
                        {expandedProjects.has(p.projectId) && p.employeeRows.map(er => (
                          <tr key={`${p.projectId}-${er.employeeId}`} className="bg-slate-25 border-b border-slate-100">
                            <td className="px-4 py-2 pl-8 text-sm">
                              <span className="text-slate-500">↳</span> {er.fullName}
                              <span className="ml-2 text-xs font-mono text-slate-400">{er.employeeCode}</span>
                            </td>
                            <td className="px-4 py-2 text-xs"></td>
                            <td className="px-4 py-2 text-right tabular-nums text-xs">—</td>
                            <td className="px-4 py-2 text-right tabular-nums text-xs">{er.days}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-xs">{fmt(er.gross)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-xs">{fmt(er.employerStatutory)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-xs font-medium">{fmt(er.totalCost)}</td>
                            <td className="px-4 py-2"></td>
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100 border-t border-slate-200">
                    <tr>
                      <td className="px-4 py-2 text-xs font-semibold" colSpan={2}>All projects</td>
                      <td className="px-4 py-2 text-right tabular-nums">{data.totals.totalAssigned}</td>
                      <td className="px-4 py-2"></td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmt(data.totals.totalGross)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmt(data.totals.totalEmployerStatutory)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmt(data.totals.totalCost)}</td>
                      <td className="px-4 py-2"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-slate-500 px-4 py-3 bg-slate-50">
                Click any project row to expand the per-employee breakdown. Cost is allocated proportionally to days assigned to each project within the period — an employee assigned 10 days to project A and 20 days to project B during a month splits 1/3 and 2/3 of their gross pay.
              </p>
            </Card>
          )}
        </>
      )}

      {!loading && !data && !error && (
        <div className="text-center py-12 text-sm text-slate-400">
          Pick a company and date range, then click <strong>Generate</strong>.
        </div>
      )}

      <Modal
        open={!!historyProject}
        onClose={() => { setHistoryProject(null); setHistoryData(null); setHistoryError(''); }}
        title={historyProject ? `Allocation history — ${historyProject.name}` : 'Allocation history'}
        size="lg"
        footer={<Btn variant="secondary" onClick={() => setHistoryProject(null)}>Close</Btn>}
      >
        {historyLoading ? (
          <PageSpinner />
        ) : historyError ? (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{historyError}</div>
        ) : historyData ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Persisted allocations across all paid payroll runs. The on-screen report above is calculated on demand;
              these rows are written when each payroll run is paid and form the audit trail for project P&L.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Tile label="Gross (TZS)" value={fmt(historyData.summary.gross)} />
              <Tile label="Employer (TZS)" value={fmt(historyData.summary.employerStatutory)} />
              <Tile label="Total cost (TZS)" value={fmt(historyData.summary.totalCost)} highlight />
            </div>
            {historyData.items.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No allocations posted yet — pay a payroll run with this project&apos;s employees assigned.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Run</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Employee</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Days</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Gross</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Employer</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {historyData.items.map(row => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{row.payrollRun?.payrollRunNumber ?? '—'}</div>
                        {row.payrollRun?.paidAt && (
                          <div className="text-[11px] text-slate-400">{new Date(row.payrollRun.paidAt).toLocaleDateString('en-GB')}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div>{row.employee?.fullName ?? '—'}</div>
                        <div className="text-[11px] font-mono text-slate-400">{row.employee?.employeeCode ?? ''}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.days}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(row.allocatedGross))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(row.allocatedEmployerStatutory))}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(Number(row.allocatedTotalCost))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className={`p-3 ${highlight ? 'bg-emerald-50 border-emerald-200' : ''}`}>
      <div className={`text-[11px] uppercase tracking-wide ${highlight ? 'text-emerald-700' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-xl font-bold mt-1 ${highlight ? 'text-emerald-800' : ''}`}>{value}</div>
    </Card>
  );
}
