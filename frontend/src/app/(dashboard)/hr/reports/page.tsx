'use client';

import { useState } from 'react';
import { Card, PageHeader, StatusBadge } from '@/components/ui';

type ReportTab = 'employees' | 'attendance' | 'payroll' | 'leave';

const TABS: { key: ReportTab; label: string; endpoint: string }[] = [
  { key: 'employees', label: 'Employee List', endpoint: '/api/backend/hr/reports/employees' },
  { key: 'attendance', label: 'Attendance Summary', endpoint: '/api/backend/hr/reports/attendance' },
  { key: 'payroll', label: 'Payroll Summary', endpoint: '/api/backend/hr/reports/payroll' },
  { key: 'leave', label: 'Leave Summary', endpoint: '/api/backend/hr/reports/leave' },
];

const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

function EmployeeReport({ data }: { data: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className={thCls}>Code</th>
            <th className={thCls}>Name</th>
            <th className={thCls}>Company</th>
            <th className={thCls}>Department</th>
            <th className={thCls}>Position</th>
            <th className={thCls}>Type</th>
            <th className={thCls}>Hire Date</th>
            <th className={thCls}>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r: any, i: number) => (
            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
              <td className={`${tdCls} font-mono`}>{r.code ?? '—'}</td>
              <td className={`${tdCls} font-medium`}>{r.fullName ?? `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim()}</td>
              <td className={tdCls}>{r.company ?? '—'}</td>
              <td className={tdCls}>{r.department ?? '—'}</td>
              <td className={tdCls}>{r.position ?? '—'}</td>
              <td className={tdCls}>{r.employmentType ?? '—'}</td>
              <td className={tdCls}>{r.hireDate ? new Date(r.hireDate).toLocaleDateString('en-GB') : '—'}</td>
              <td className={tdCls}><StatusBadge status={r.status ?? 'ACTIVE'} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttendanceReport({ data }: { data: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className={thCls}>Employee</th>
            <th className={thCls}>Present Days</th>
            <th className={thCls}>Absent Days</th>
            <th className={thCls}>Late Days</th>
            <th className={thCls}>Total Hours</th>
            <th className={thCls}>Period</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r: any, i: number) => (
            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
              <td className={`${tdCls} font-medium`}>{r.employee ?? r.employeeId ?? '—'}</td>
              <td className={`${tdCls} text-green-600 font-medium`}>{r.presentDays ?? '—'}</td>
              <td className={`${tdCls} text-red-600`}>{r.absentDays ?? '—'}</td>
              <td className={`${tdCls} text-amber-600`}>{r.lateDays ?? '—'}</td>
              <td className={tdCls}>{r.totalHours ?? '—'}</td>
              <td className={tdCls}>{r.period ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PayrollReport({ data }: { data: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className={thCls}>Period</th>
            <th className={thCls}>Company</th>
            <th className={thCls}>Employees</th>
            <th className={thCls}>Total Gross</th>
            <th className={thCls}>Total Deductions</th>
            <th className={thCls}>Total Net</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r: any, i: number) => (
            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
              <td className={`${tdCls} font-medium`}>{r.period ?? '—'}</td>
              <td className={tdCls}>{r.company ?? '—'}</td>
              <td className={tdCls}>{r.employeeCount ?? '—'}</td>
              <td className={tdCls}>TZS {(Number.isFinite(Number(r.totalGross ?? 0)) ? Number(r.totalGross ?? 0).toLocaleString('en-TZ') : '0')}</td>
              <td className={`${tdCls} text-red-600`}>TZS {(Number.isFinite(Number(r.totalDeductions ?? 0)) ? Number(r.totalDeductions ?? 0).toLocaleString('en-TZ') : '0')}</td>
              <td className={`${tdCls} font-semibold text-green-700`}>TZS {(Number.isFinite(Number(r.totalNet ?? 0)) ? Number(r.totalNet ?? 0).toLocaleString('en-TZ') : '0')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaveReport({ data }: { data: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className={thCls}>Employee</th>
            <th className={thCls}>Leave Type</th>
            <th className={thCls}>Approved Days</th>
            <th className={thCls}>Pending</th>
            <th className={thCls}>Rejected</th>
            <th className={thCls}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r: any, i: number) => (
            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
              <td className={`${tdCls} font-medium`}>{r.employee ?? r.employeeId ?? '—'}</td>
              <td className={tdCls}>{r.leaveType ?? '—'}</td>
              <td className={`${tdCls} text-green-600 font-medium`}>{r.approvedDays ?? '—'}</td>
              <td className={`${tdCls} text-amber-600`}>{r.pendingDays ?? '—'}</td>
              <td className={`${tdCls} text-red-600`}>{r.rejectedDays ?? '—'}</td>
              <td className={`${tdCls} font-medium`}>{r.balance ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HRReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('employees');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const runReport = async () => {
    setLoading(true);
    setLoaded(false);
    const tab = TABS.find(t => t.key === activeTab)!;
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const r = await fetch(`${tab.endpoint}?${params}`);
    const j = await r.json();
    setData(j.data?.data ?? j.data ?? j ?? []);
    setLoading(false);
    setLoaded(true);
  };

  const handleTabChange = (tab: ReportTab) => {
    setActiveTab(tab);
    setData([]);
    setLoaded(false);
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="HR Reports" subtitle="Generate HR, Payroll and Attendance reports" />

      {/* Report Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => handleTabChange(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === t.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-end gap-3">
        {(activeTab === 'attendance' || activeTab === 'payroll' || activeTab === 'leave') && (
          <>
            <div>
              <label className="block text-xs text-slate-500 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </>
        )}
        <button onClick={runReport} disabled={loading}
          className="px-5 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          {loading ? 'Generating…' : 'Generate Report'}
        </button>
      </div>

      {/* Report Output */}
      {loading && (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
      )}

      {loaded && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">{TABS.find(t => t.key === activeTab)?.label} — {data.length} records</span>
          </div>
          {data.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">No data found for this report.</div>
          ) : (
            <>
              {activeTab === 'employees' && <EmployeeReport data={data} />}
              {activeTab === 'attendance' && <AttendanceReport data={data} />}
              {activeTab === 'payroll' && <PayrollReport data={data} />}
              {activeTab === 'leave' && <LeaveReport data={data} />}
            </>
          )}
        </Card>
      )}

      {!loaded && !loading && (
        <Card className="p-10 text-center text-slate-400 text-sm">
          Select a report type above and click <strong className="text-slate-600">Generate Report</strong> to view results.
        </Card>
      )}
    </div>
  );
}
