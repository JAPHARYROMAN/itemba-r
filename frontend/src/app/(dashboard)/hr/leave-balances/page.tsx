'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, Btn, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useOrgScope } from '@/hooks/use-org-scope';
import {
  AllocationModal,
  type LeaveBalanceRecord,
} from './_components/AllocationModal';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';
const filterSelectCls =
  'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = {
  borderColor: 'var(--aurora-border)',
  background: 'var(--aurora-card)',
  color: 'var(--aurora-text)',
};

interface LeaveTypeOption {
  id: string;
  name: string;
}

const PAGE_SIZE = 20;
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR + 1 - i);

const num = (v: number | string | null | undefined) => Number(v ?? 0);
const fmtDays = (v: number) =>
  v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
const remainingOf = (b: LeaveBalanceRecord) =>
  num(b.allocatedDays) + num(b.carriedForwardDays) - num(b.usedDays);

export default function LeaveBalancesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('leave_balances.manage');
  const canView = hasPermission('leave_balances.view') || canManage;

  const [rows, setRows] = useState<LeaveBalanceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [companyId, setCompanyId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [year, setYear] = useState('');
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);

  const [allocating, setAllocating] = useState(false);
  const [adjusting, setAdjusting] = useState<LeaveBalanceRecord | null>(null);

  const { companies, employees } = useOrgScope(companyId, {
    skipBranches: true,
    skipDivisions: true,
  });

  // Leave types are company-scoped; refresh the filter options with the company.
  useEffect(() => {
    if (!companyId) {
      setLeaveTypes([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/backend/hr/leave-types?companyId=${companyId}&limit=200`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
        setLeaveTypes(list);
      })
      .catch(() => {
        if (!cancelled) setLeaveTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (companyId) params.set('companyId', companyId);
    if (employeeId) params.set('employeeId', employeeId);
    if (leaveTypeId) params.set('leaveTypeId', leaveTypeId);
    if (year) params.set('year', year);
    const j = await fetch(`/api/backend/hr/leave-balances?${params}`)
      .then((r) => r.json())
      .catch(() => ({}));
    const p = j.data ?? {};
    const data: LeaveBalanceRecord[] = Array.isArray(p.data) ? p.data : [];
    const totalCount = Number(p.total ?? data.length);
    setRows(data);
    setTotal(totalCount);
    setTotalPages(Math.max(1, Math.ceil(totalCount / Number(p.limit ?? PAGE_SIZE))));
    setLoading(false);
  }, [page, companyId, employeeId, leaveTypeId, year]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };
  const onCompanyFilter = (v: string) => {
    setCompanyId(v);
    setEmployeeId('');
    setLeaveTypeId('');
    setPage(1);
  };
  const onSaved = () => {
    setAllocating(false);
    setAdjusting(null);
    load();
  };

  const allocatedPage = rows.reduce((s, b) => s + num(b.allocatedDays) + num(b.carriedForwardDays), 0);
  const usedPage = rows.reduce((s, b) => s + num(b.usedDays), 0);
  const remainingPage = rows.reduce((s, b) => s + remainingOf(b), 0);

  if (!canView)
    return (
      <div className="p-6">
        <PageHeader title="Leave Balances" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Leave Balances"
        subtitle="Annual leave allocations, usage and remaining days per employee"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Balances" value={total} />
        <StatCard label="Allocated (page)" value={fmtDays(allocatedPage)} />
        <StatCard label="Used (page)" value={fmtDays(usedPage)} />
        <StatCard label="Remaining (page)" value={fmtDays(remainingPage)} />
      </div>

      <PageToolbar
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => onCompanyFilter(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by company"
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={employeeId}
              onChange={(e) => reset(setEmployeeId)(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by employee"
              disabled={!companyId}
            >
              <option value="">{companyId ? 'All Employees' : 'Employee (pick company)'}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName ?? emp.employeeCode ?? emp.id}
                </option>
              ))}
            </select>
            <select
              value={leaveTypeId}
              onChange={(e) => reset(setLeaveTypeId)(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by leave type"
              disabled={!companyId}
            >
              <option value="">{companyId ? 'All Leave Types' : 'Leave type (pick company)'}</option>
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name}
                </option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => reset(setYear)(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
              aria-label="Filter by year"
            >
              <option value="">All Years</option>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          canManage ? (
            <Btn variant="primary" onClick={() => setAllocating(true)}>
              + Allocate / Adjust
            </Btn>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead
                className="bg-slate-50 border-b border-slate-100"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Company</th>
                  <th className={thCls}>Leave Type</th>
                  <th className={thCls}>Year</th>
                  <th className={`${thCls} text-right`}>Allocated</th>
                  <th className={`${thCls} text-right`}>Carried Fwd</th>
                  <th className={`${thCls} text-right`}>Used</th>
                  <th className={`${thCls} text-right`}>Remaining</th>
                  {canManage && <th className={`${thCls} text-right`}>Actions</th>}
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map((b) => {
                  const remaining = remainingOf(b);
                  return (
                    <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>
                        {b.employee?.fullName ?? b.employee?.employeeCode ?? b.employeeId}
                        {b.employee?.fullName && b.employee?.employeeCode && (
                          <span
                            className="ml-1.5 text-xs font-normal"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            {b.employee.employeeCode}
                          </span>
                        )}
                      </td>
                      <td className={`${tdCls} text-xs`}>{b.company?.name ?? '—'}</td>
                      <td className={tdCls}>{b.leaveType?.name ?? '—'}</td>
                      <td className={tdCls}>{b.year}</td>
                      <td className={`${tdCls} text-right`}>{fmtDays(num(b.allocatedDays))}</td>
                      <td className={`${tdCls} text-right`}>
                        {fmtDays(num(b.carriedForwardDays))}
                      </td>
                      <td className={`${tdCls} text-right`}>{fmtDays(num(b.usedDays))}</td>
                      <td
                        className={`${tdCls} text-right font-medium ${remaining < 0 ? 'text-red-600' : ''}`}
                      >
                        {fmtDays(remaining)}
                      </td>
                      {canManage && (
                        <td className={`${tdCls} text-right whitespace-nowrap`}>
                          <Btn variant="ghost" size="xs" onClick={() => setAdjusting(b)}>
                            Adjust
                          </Btn>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={canManage ? 9 : 8}
                      className="text-center py-8 text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No leave balances found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div
            className="flex items-center justify-between p-3 border-t"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {page} of {totalPages} ({total} total)
            </span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </Card>

      {allocating && (
        <AllocationModal
          companies={companies}
          onClose={() => setAllocating(false)}
          onSaved={onSaved}
        />
      )}
      {adjusting && (
        <AllocationModal
          initial={adjusting}
          companies={companies}
          onClose={() => setAdjusting(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
