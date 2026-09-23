'use client';
import { useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import {
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  RefreshCw,
  Users,
  WalletCards,
} from 'lucide-react';
import { FormSelect, PermissionDeniedState, StatusBadge } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { PAYROLL_APP_PERMISSIONS, PAYROLL_INPUTS, PAYROLL_TABS } from '@/lib/payroll-app';
import { type PayrollRunRecord, runName, periodName } from '@/components/workspace/payroll-types';
import { money } from '@/features/invoice-desk/types';
import './payroll.css';
type Runs = { data: PayrollRunRecord[]; total: number };
export function PayrollHome() {
  const { hasPermission } = useAuth(),
    canRead = hasPermission('payroll.view'),
    canReadEmployees = hasPermission('employees.view');
  const allowed = PAYROLL_APP_PERMISSIONS.some((p) => hasPermission(p));
  const [companyId, setCompanyId] = useState('');
  const scope: Record<string, string> = companyId ? { companyId } : {};
  const companies = useWorkspaceChoices<{ id: string; name: string }>(
    '/companies',
    {},
    (canRead || canReadEmployees) && hasPermission('companies.read'),
  );
  const recent = useWorkspaceResource<Runs>(
    '/hr/payroll-runs',
    { ...scope, page: 1, limit: 5 },
    canRead,
  );
  const drafts = useWorkspaceResource<Runs>(
    '/hr/payroll-runs',
    { ...scope, page: 1, limit: 1, status: 'DRAFT' },
    canRead,
  );
  const submitted = useWorkspaceResource<Runs>(
    '/hr/payroll-runs',
    { ...scope, page: 1, limit: 1, status: 'SUBMITTED' },
    canRead,
  );
  const approved = useWorkspaceResource<Runs>(
    '/hr/payroll-runs',
    { ...scope, page: 1, limit: 1, status: 'APPROVED' },
    canRead,
  );
  const refresh = () => {
    recent.reload();
    drafts.reload();
    submitted.reload();
    approved.reload();
    companies.retry();
    employees.reload();
    activeEmployees.reload();
  };
  const employees = useWorkspaceResource<{ total: number }>(
    '/hr/employees',
    { ...scope, page: 1, limit: 1 },
    canReadEmployees,
  );
  const activeEmployees = useWorkspaceResource<{ total: number }>(
    '/hr/employees',
    { ...scope, page: 1, limit: 1, employmentStatus: 'ACTIVE' },
    canReadEmployees,
  );
  const employeeLink = (active = false) =>
    '/hr/employees' +
    (companyId || active
      ? '?' +
        new URLSearchParams({
          ...scope,
          ...(active ? { employmentStatus: 'ACTIVE' } : {}),
        }).toString()
      : '');
  const runLink = (status?: string) =>
    '/hr/payroll-runs' +
    (companyId || status
      ? '?' + new URLSearchParams({ ...scope, ...(status ? { status } : {}) }).toString()
      : '');
  if (!allowed)
    return (
      <PermissionDeniedState description="Ask your administrator for Payroll access to open this app." />
    );
  return (
    <div className="payroll-home">
      <header className="payroll-heading">
        <div>
          <p className="payroll-eyebrow">YOUR PEOPLE. THEIR PAY.</p>
          <h1>Your people. From day one to payday.</h1>
          <p>Employee records, time at work and payroll, together in one place.</p>
        </div>
        <button className="payroll-refresh" aria-label="Refresh Payroll" onClick={refresh}>
          <RefreshCw size={18} />
        </button>
      </header>
      {(canRead || canReadEmployees) && (
        <>
          <div className="payroll-scope">
            {hasPermission('companies.read') ? (
              <FormSelect
                label="Company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                disabled={companies.loading || !!companies.error}
                options={[
                  { value: '', label: 'All accessible companies' },
                  ...companies.rows.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            ) : (
              <strong>Your accessible companies</strong>
            )}
            <p>
              Pay cycles belong to a company. Employee records retain their division and branch.
            </p>
          </div>
          {companies.error && (
            <p className="payroll-error" role="alert">
              Company choices unavailable. {companies.error}{' '}
              <button onClick={companies.retry}>Retry</button>
            </p>
          )}
        </>
      )}
      {canReadEmployees && (
        <section className="payroll-workforce" aria-label="Employee overview">
          <div className="payroll-section-heading">
            <div>
              <h2>Your employees</h2>
              <p>Profiles, employment details, salary and payment information.</p>
            </div>
            <Link className="payroll-primary-link" href={employeeLink()}>
              <Users size={16} />
              Manage employees
            </Link>
          </div>
          <div className="payroll-workforce-metrics">
            {[
              { label: 'Employee records', result: employees, href: employeeLink() },
              { label: 'Active employees', result: activeEmployees, href: employeeLink(true) },
            ].map((item) => (
              <Link key={item.label} href={item.href}>
                <span>{item.label}</span>
                <strong>
                  {item.result.loading
                    ? '…'
                    : item.result.error
                      ? '—'
                      : (item.result.data?.total ?? 0)}
                </strong>
                <ChevronRight size={15} />
              </Link>
            ))}
          </div>
          {(employees.error || activeEmployees.error) && (
            <p role="alert" className="payroll-error">
              Employee overview unavailable. {employees.error || activeEmployees.error}{' '}
              <button onClick={refresh}>Retry</button>
            </p>
          )}
          <p className="payroll-employee-note">
            Open an employee to manage their profile, statutory details, banking, assignments,
            contracts, attendance, leave, payroll history and documents.
          </p>
        </section>
      )}
      {!canRead ? (
        <section className="payroll-welcome">
          <WalletCards size={28} />
          <h2>Your payroll workspace</h2>
          <p>Open the tools available to your role below.</p>
          <div className="payroll-quick-links">
            {PAYROLL_TABS.filter(
              (t) => t.href != '/payroll' && t.permissions.some((p) => hasPermission(p)),
            ).map((t) => (
              <Link key={t.href} href={t.href}>
                {t.label}
                <ChevronRight size={15} />
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <>
          <div className="payroll-metrics">
            {[
              {
                label: 'In preparation',
                note: 'Draft runs to calculate',
                status: 'DRAFT',
                result: drafts,
              },
              {
                label: 'Awaiting sign-off',
                note: 'Submitted for review',
                status: 'SUBMITTED',
                result: submitted,
              },
              {
                label: 'Ready for payment',
                note: 'Approved payroll runs',
                status: 'APPROVED',
                result: approved,
              },
            ].map((item) => (
              <Link key={item.status} href={runLink(item.status)}>
                <span>
                  {item.label}
                  <ChevronRight size={14} />
                </span>
                <strong>
                  {item.result.loading
                    ? '…'
                    : item.result.error
                      ? '—'
                      : (item.result.data?.total ?? 0)}
                </strong>
                <small>{item.result.error ? 'Unable to load. Refresh to retry.' : item.note}</small>
              </Link>
            ))}
          </div>
          {[drafts, submitted, approved].some((r) => r.error) && (
            <p className="payroll-error" role="alert">
              Some payroll counts could not be loaded. <button onClick={refresh}>Retry</button>
            </p>
          )}
          <div className="payroll-section-heading">
            <h2>Recent pay cycles</h2>
            <Link href={runLink()}>
              View all runs <ChevronRight size={14} />
            </Link>
          </div>
          {recent.loading ? (
            <p role="status" className="payroll-feedback">
              Loading payroll runs…
            </p>
          ) : recent.error ? (
            <div role="alert" className="payroll-error">
              {recent.error} <button onClick={recent.reload}>Retry runs</button>
            </div>
          ) : !recent.data?.data.length ? (
            <section className="payroll-welcome">
              <CalendarDays size={28} />
              <h2>Your next payday starts here</h2>
              <p>Set up a pay period, then create a payroll run for that company.</p>
              <Link className="payroll-primary-link" href="/hr/payroll-periods">
                Open pay periods <ChevronRight size={15} />
              </Link>
            </section>
          ) : (
            <div className="payroll-recent">
              {recent.data.data.map((run) => (
                <Link
                  key={run.id}
                  href={'/hr/payroll-entries?payrollRunId=' + encodeURIComponent(run.id)}
                >
                  <span className="payroll-run-icon">
                    <WalletCards size={20} />
                  </span>
                  <span className="payroll-run-name">
                    <strong>{runName(run)}</strong>
                    <small>
                      {periodName(run)} · {run.company?.name ?? 'Company'}
                    </small>
                  </span>
                  <span className="payroll-run-pay">
                    <small>Net pay</small>
                    <strong>
                      {run.totalNetPay == null ? '—' : money(String(run.totalNetPay), 'TZS')}
                    </strong>
                  </span>
                  <StatusBadge status={run.status} />
                  <ChevronRight size={15} />
                </Link>
              ))}
            </div>
          )}
          <section className="payroll-steps" aria-label="Payroll process">
            <div>
              <CalendarDays size={18} />
              <h3>1. Prepare</h3>
              <p>Set up employees, contracts, attendance and pay inputs for the period.</p>
            </div>
            <div>
              <ClipboardCheck size={18} />
              <h3>2. Review</h3>
              <p>Calculate the run, then complete HR and Finance sign-off.</p>
            </div>
            <div>
              <WalletCards size={18} />
              <h3>3. Record</h3>
              <p>Record approved payments and open employee payslips.</p>
            </div>
          </section>
        </>
      )}
      <div className="payroll-support">
        {hasPermission('employees.view') && (
          <Link href="/hr/employees">
            <Users size={17} />
            Employee records
            <ChevronRight size={14} />
          </Link>
        )}
        {PAYROLL_INPUTS.some((x) => hasPermission(x.permission)) && (
          <Link href="/payroll/inputs">
            Allowances, deductions & advances
            <ChevronRight size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}
export function PayrollInputs() {
  const { hasPermission } = useAuth(),
    inputs = PAYROLL_INPUTS.filter((x) => hasPermission(x.permission));
  if (!inputs.length)
    return <PermissionDeniedState description="Your role cannot view payroll inputs." />;
  return (
    <div className="payroll-home">
      <header className="payroll-heading">
        <div>
          <p className="payroll-eyebrow">BEFORE YOU CALCULATE</p>
          <h1>Pay inputs</h1>
          <p>Keep allowances, deductions and advances ready for the next pay cycle.</p>
        </div>
      </header>
      <div className="payroll-input-grid">
        {inputs.map((x) => (
          <Link key={x.href} href={x.href}>
            <h2>
              {x.label}
              <ChevronRight size={16} />
            </h2>
            <p>{x.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
