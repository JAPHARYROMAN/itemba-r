'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { Btn, FormSelect, PageHeader, PermissionDeniedState, StatusBadge } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { payrollMoney } from './payroll-types';
import { disputeDate } from './dispute-types';
import { peopleDestinations, type PeopleDashboard } from './people-hub-types';
import './workspace.css';
import './people-hub.css';

function Metrics({ values }: { values: Array<[string, ReactNode]> }) {
  return (
    <dl className="people-metrics">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function PeopleHub() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('hr.dashboard.view');
  const [companyId, setCompanyId] = useState('');
  const result = useWorkspaceResource<PeopleDashboard>('/hr/dashboard', { companyId }, canRead);
  const companies = useWorkspaceChoices<{ id: string; name: string }>(
    '/companies',
    {},
    canRead && hasPermission('companies.read'),
  );
  const destinations = peopleDestinations.filter((d) => hasPermission(d.permission));
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view the People overview." />;
  const data = result.data;
  const count = (value: number) => value.toLocaleString('en-GB');
  const attention = data
    ? [
        {
          label: 'Leave awaiting approval',
          note: 'Submitted requests',
          value: data.leave.pendingApproval,
          href: '/hr/leave-requests',
          permission: 'leave_requests.view',
        },
        {
          label: 'Contracts expiring',
          note: 'Within the next 30 days',
          value: data.contracts.expiringWithin30Days,
          href: '/hr/employment-contracts',
          permission: 'employment_contracts.view',
        },
        {
          label: 'Medical exams expiring',
          note: 'Within the next 30 days',
          value: data.compliance.expiringMedicalExams,
          href: '/hr/medical-exams',
          permission: 'employees.view',
        },
        {
          label: 'Open disputes',
          note: 'Excludes resolved, dismissed and withdrawn cases',
          value: data.compliance.openDisputes,
          href: '/hr/disputes',
          permission: 'employees.view',
        },
      ]
    : [];
  return (
    <div className="business-workspace people-hub">
      <PageHeader
        title="People"
        subtitle="A clear view of your workforce and the work ahead."
        actions={
          <>
            {hasPermission('hr.reports.view') && (
              <Link className="workspace-secondary-link" href="/hr/reports">
                People reports
              </Link>
            )}
            <Btn variant="secondary" onClick={result.reload} disabled={result.loading}>
              Refresh
            </Btn>
          </>
        }
      />
      <div className="people-scope">
        {hasPermission('companies.read') ? (
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
            placeholder={companies.loading ? 'Loading companies…' : 'All accessible companies'}
            disabled={companies.loading || !!companies.error}
          />
        ) : (
          <p>Showing the companies you can access.</p>
        )}
        <p>Workforce, payroll and attendance for this scope.</p>
      </div>
      {companies.error && (
        <div role="alert" className="workspace-notice">
          Company choices unavailable. {companies.error}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      {result.loading ? (
        <div role="status" className="people-feedback">
          Loading your People overview…
        </div>
      ) : result.error ? (
        <div role="alert" className="people-feedback">
          <h2>People overview unavailable</h2>
          <p>{result.error}</p>
          <Btn onClick={result.reload}>Try again</Btn>
        </div>
      ) : (
        data && (
          <>
            <section className="people-workforce" aria-label="Workforce">
              <div className="people-section-heading">
                <h2>Workforce</h2>
                <p>{data.workforce.activeRate}% active</p>
              </div>
              <Metrics
                values={[
                  ['Total employees', count(data.workforce.total)],
                  ['Active employees', count(data.workforce.active)],
                  ['On leave', count(data.workforce.onLeave)],
                  ['Suspended', count(data.workforce.suspended)],
                ]}
              />
            </section>
            <div className="people-columns">
              <section className="people-panel" aria-label="Attention">
                <div className="people-section-heading">
                  <h2>Attention</h2>
                  <p>Requests and upcoming dates</p>
                </div>
                <ul className="people-attention">
                  {attention.map((item) => (
                    <li key={item.label}>
                      {hasPermission(item.permission) ? (
                        <Link href={item.href}>
                          <span>
                            <strong>{item.label}</strong>
                            <small>{item.note}</small>
                          </span>
                          <b>{count(item.value)}</b>
                          <ChevronRight size={16} aria-hidden="true" />
                        </Link>
                      ) : (
                        <div>
                          <span>
                            <strong>{item.label}</strong>
                            <small>{item.note}</small>
                          </span>
                          <b>{count(item.value)}</b>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <section className="people-panel" aria-label="Attendance today">
                <div className="people-section-heading">
                  <h2>Attendance today</h2>
                  {hasPermission('attendance.view') && (
                    <Link href="/hr/attendance" aria-label="Open attendance">
                      <ArrowUpRight size={18} />
                    </Link>
                  )}
                </div>
                <Metrics
                  values={[
                    ['Scheduled shifts', count(data.attendance.scheduledShiftsToday)],
                    ['Capture rate', `${data.attendance.attendanceCaptureRate}%`],
                    ['Present', count(data.attendance.presentToday)],
                    ['Absent', count(data.attendance.absentToday)],
                    ['Late', count(data.attendance.lateToday)],
                  ]}
                />
                <p className="people-caption">
                  Capture rate compares present, absent and late records with scheduled shifts.
                </p>
              </section>
              <section className="people-panel" aria-label="Payroll this month">
                <div className="people-section-heading">
                  <h2>Payroll this month</h2>
                  {hasPermission('payroll.view') && (
                    <Link href="/hr/payroll-runs" aria-label="Open payroll runs">
                      <ArrowUpRight size={18} />
                    </Link>
                  )}
                </div>
                <p className="people-caption">Amounts from runs marked paid this month.</p>
                <Metrics
                  values={[
                    ['Net pay', payrollMoney(data.payroll.netPayThisMonth)],
                    ['Gross pay', payrollMoney(data.payroll.grossPayThisMonth)],
                    ['Deductions', payrollMoney(data.payroll.deductionsThisMonth)],
                    ['Paid runs', count(data.payroll.paidRunsThisMonth)],
                    ['Open pay periods', count(data.payroll.openPeriods)],
                    ['Runs in progress', count(data.payroll.runsInFlight)],
                  ]}
                />
              </section>
              <section className="people-panel" aria-label="Employment records">
                <div className="people-section-heading">
                  <h2>Employment records</h2>
                </div>
                <Metrics
                  values={[
                    ['Active contracts', count(data.contracts.active)],
                    ['Approved leave requests', count(data.leave.approved)],
                    ['HR documents', count(data.compliance.totalHrDocuments)],
                    [
                      'Active disciplinary actions',
                      count(data.compliance.activeDisciplinaryActions),
                    ],
                  ]}
                />
                {hasPermission('employment_contracts.view') && (
                  <details className="people-expiries">
                    <summary>Upcoming contract expiries</summary>
                    {data.upcomingContractExpiries.length ? (
                      <ul>
                        {data.upcomingContractExpiries.map((c) => (
                          <li key={c.id}>
                            <strong>{c.contractCode}</strong>
                            <span>{disputeDate(c.endDate)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No active contracts expire in the next 30 days.</p>
                    )}
                    <Link href="/hr/employment-contracts">Open contracts</Link>
                  </details>
                )}
              </section>
              <section className="people-panel" aria-label="Active employees by company">
                <div className="people-section-heading">
                  <h2>Active employees by company</h2>
                </div>
                {data.employeesByCompany.length ? (
                  <ul className="people-company-list">
                    {data.employeesByCompany.map((c) => (
                      <li key={c.companyId}>
                        <span>
                          <strong>{c.company}</strong>
                          {c.code && <small>{c.code}</small>}
                        </span>
                        <b>{count(c.count)}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="people-caption">No active employees in this scope.</p>
                )}
              </section>
              {hasPermission('employees.view') && (
                <section className="people-panel" aria-label="Recently added employees">
                  <div className="people-section-heading">
                    <h2>Recently added employees</h2>
                    <Link href="/hr/employees">View all</Link>
                  </div>
                  {data.recentEmployees.length ? (
                    <ul className="people-recent">
                      {data.recentEmployees.map((employee) => (
                        <li key={employee.id}>
                          <Link href={`/hr/employees/${employee.id}`}>
                            <span>
                              <strong>{employee.fullName || employee.employeeCode}</strong>
                              <small>{employee.employeeCode}</small>
                            </span>
                            <StatusBadge value={employee.employmentStatus} />
                            <ChevronRight size={16} aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="people-caption">No employee profiles in this scope.</p>
                  )}
                </section>
              )}
            </div>
          </>
        )
      )}
      {destinations.length > 0 && (
        <nav aria-label="People workspaces" className="people-destinations">
          <h2>Your People workspaces</h2>
          <div>
            {destinations.map((d) => (
              <Link key={d.href} href={d.href}>
                <span>
                  <strong>{d.label}</strong>
                  <small>{d.description}</small>
                </span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
