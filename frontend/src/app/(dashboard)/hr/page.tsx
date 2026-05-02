'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard } from '@/components/ui';

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

interface HRDashboard {
  totalActiveEmployees: number;
  activeContracts: number;
  pendingLeaveRequests: number;
  openPayrollPeriods: number;
  employeesByCompany: { company: string; count: number }[];
  workforce?: {
    total?: number;
    active?: number;
    onLeave?: number;
    suspended?: number;
    activeRate?: number;
  };
  contracts?: {
    active?: number;
    expiringWithin30Days?: number;
  };
  leave?: {
    pendingApproval?: number;
    approved?: number;
  };
  payroll?: {
    openPeriods?: number;
    runsInFlight?: number;
    paidRunsThisMonth?: number;
    grossPayThisMonth?: number;
    netPayThisMonth?: number;
  };
  attendance?: {
    scheduledShiftsToday?: number;
    presentToday?: number;
    absentToday?: number;
    lateToday?: number;
    attendanceCaptureRate?: number;
  };
  compliance?: {
    totalHrDocuments?: number;
    expiringMedicalExams?: number;
    openDisputes?: number;
    activeDisciplinaryActions?: number;
  };
  recentEmployees?: Array<{
    id: string;
    employeeCode?: string;
    fullName?: string;
    employmentStatus?: string;
  }>;
}

function fmtCurrency(n: number) {
  return `TZS ${new Intl.NumberFormat('en-US').format(n)}`;
}

const quickLinks = [
  { href: '/hr/employees', label: 'Employees', desc: 'All employee profiles' },
  { href: '/hr/departments', label: 'Departments', desc: 'Manage departments' },
  { href: '/hr/positions', label: 'Positions', desc: 'Job positions' },
  { href: '/hr/employment-contracts', label: 'Contracts', desc: 'Employment contracts' },
  { href: '/hr/attendance', label: 'Attendance', desc: 'Clock in/out records' },
  { href: '/hr/leave-requests', label: 'Leave Requests', desc: 'Leave approvals' },
  { href: '/hr/payroll-runs', label: 'Payroll Runs', desc: 'Process payroll' },
  { href: '/hr/payroll-periods', label: 'Payroll Periods', desc: 'Manage pay periods' },
  { href: '/hr/work-shifts', label: 'Work Shifts', desc: 'Shift management' },
  { href: '/hr/shift-schedules', label: 'Shift Schedules', desc: 'Employee schedules' },
  { href: '/hr/performance', label: 'Performance', desc: 'Performance reviews' },
  { href: '/hr/reports', label: 'Reports', desc: 'HR analytics' },
];

export default function HRDashboardPage() {
  const [data, setData] = useState<HRDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/hr/dashboard')
      .then((r) => r.json())
      .then((j) => {
        setData(j.data ?? j);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="HR Dashboard" subtitle="Human Resources, Payroll & Workforce Management" />
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && <Spinner />}
      {data && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Active Employees" value={data.totalActiveEmployees} variant="blue" />
            <StatCard label="Active Contracts" value={data.activeContracts} variant="green" />
            <StatCard label="Pending Leave" value={data.pendingLeaveRequests} variant="amber" />
            <StatCard
              label="Open Payroll Periods"
              value={data.openPayrollPeriods}
              variant="purple"
            />
            <StatCard label="On Leave" value={data.workforce?.onLeave ?? 0} />
            <StatCard
              label="Contracts Expiring"
              value={data.contracts?.expiringWithin30Days ?? 0}
            />
            <StatCard label="Payroll In Flight" value={data.payroll?.runsInFlight ?? 0} />
            <StatCard
              label="Net Pay This Month"
              value={fmtCurrency(data.payroll?.netPayThisMonth ?? 0)}
            />
            <StatCard label="Shifts Today" value={data.attendance?.scheduledShiftsToday ?? 0} />
            <StatCard
              label="Attendance Captured"
              value={`${data.attendance?.attendanceCaptureRate ?? 0}%`}
            />
            <StatCard label="Medical Expiries" value={data.compliance?.expiringMedicalExams ?? 0} />
            <StatCard label="Open Disputes" value={data.compliance?.openDisputes ?? 0} />
          </div>
          {data.employeesByCompany?.length > 0 && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Employees by Company</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {data.employeesByCompany.map((c) => (
                  <div key={c.company} className="bg-slate-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-slate-800">{c.count}</div>
                    <div className="text-xs text-slate-500 mt-1">{c.company}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
      <div>
        <h3 className="text-sm font-semibold text-slate-600 mb-3">Quick Links</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickLinks.map((l) => (
            <Link key={l.href} href={l.href}>
              <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="font-medium text-slate-800 text-sm">{l.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{l.desc}</div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
