'use client';
import { useEffect, useState } from 'react';
import { Btn, FormSelect, PageHeader, PageToolbar, PermissionDeniedState } from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { payrollLabel, payrollMoney } from '@/components/workspace/payroll-types';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import '@/components/workspace/workspace.css';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { usePayrollStateKey, usePayrollDraftEditor } from '@/features/payroll/payroll-drafts';
import {
  type Company,
  type SalaryPayment,
  statuses,
  dateLabel,
  employeeName,
} from '@/features/payroll/salary-payment-types';

export default function SalaryPaymentsPage() {
  const { hasPermission } = useAuth();
  const router = useGuardedRouter();
  const canRead = hasPermission('salary_payments.view');
  const stateKey = usePayrollStateKey('salary-payments');
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', ''),
    [query, setQuery] = useState(search.trim()),
    [company, setCompany] = useWorkspaceState(stateKey + '.company', ''),
    [status, setStatus] = useWorkspaceState(stateKey + '.status', ''),
    [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  const result = useWorkspaceRecords<SalaryPayment>(
    '/hr/salary-payments',
    { page, limit: 20, search: query, companyId: company, status },
    canRead,
  );
  useEffect(() => {
    if (!result.loading && !result.error && page > 1 && !result.rows.length)
      setPage(Math.max(1, Math.ceil(result.total / 20)));
  }, [result.loading, result.error, result.rows.length, result.total, page, setPage]);
  const companies = useWorkspaceChoices<Company>('/companies', {}, canRead);
  const saved = (message: string) => {
    setNotice(message);
    void result.reload();
  };
  const entry = usePayrollDraftEditor('salary-payment-reversal', saved);
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view salary payments." />;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Salary payments"
        subtitle="Review disbursements and employee entries. Record or reverse connected payments in Payroll runs."
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Salary payments' }]}
        actions={
          hasPermission('payroll.view') && (
            <Btn variant="primary" onClick={() => router.push('/hr/payroll-runs')}>
              Record payment
            </Btn>
          )
        }
      />
      <div className="workspace-summary">
        <div>
          <span>Matching payments</span>
          <strong>{result.total}</strong>
        </div>
      </div>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {companies.error && (
        <div role="alert" className="workspace-notice">
          {companies.error}{' '}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search payment, employee or reference…"
        collapsibleFilters
        activeFilterCount={Number(!!company) + Number(!!status)}
        filters={
          <>
            <FormSelect
              label="Company filter"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setPage(1);
              }}
              options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="All companies"
            />
            <FormSelect
              label="Status filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={statuses.map((s) => ({ value: s, label: payrollLabel(s) }))}
              placeholder="All statuses"
            />
          </>
        }
        actions={
          <Btn variant="secondary" onClick={result.reload} disabled={result.loading}>
            Reload
          </Btn>
        }
      />
      {entry.drafts}
      <RecordBrowser
        stateKey={stateKey + '.selection'}
        selectionScope={JSON.stringify([company, status, query])}
        title="Salary payments"
        records={result.rows}
        name={employeeName}
        reference={(r) => r.salaryPaymentNumber}
        status={(r) => r.status}
        fields={[
          { label: 'Amount', value: (r) => payrollMoney(r.amount) },
          { label: 'Payment date', value: (r) => dateLabel(r.paymentDate) },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || '—' },
          { label: 'Employee code', value: (r) => r.employee?.employeeCode || '—' },
          { label: 'Method', value: (r) => payrollLabel(r.paymentMethod) },
          { label: 'Reference', value: (r) => r.reference || '—' },
          { label: 'Notes', value: (r) => r.notes || '—' },
        ]}
        actions={(r) => (
          <>
            {hasPermission('payroll.view') && r.payrollEntryId && (
              <Btn
                variant="secondary"
                onClick={() => router.push('/hr/payslips/' + encodeURIComponent(r.payrollEntryId))}
              >
                View payslip
              </Btn>
            )}
            {hasPermission('payroll.view') && r.payrollRunId && (
              <Btn
                variant="ghost"
                onClick={() =>
                  router.push(
                    '/hr/payroll-entries?payrollRunId=' + encodeURIComponent(r.payrollRunId),
                  )
                }
              >
                View run entries
              </Btn>
            )}
            {!r.cashMovementId &&
              hasPermission('salary_payments.reverse') &&
              r.status === 'PAID' && (
                <Btn
                  variant="danger"
                  onClick={() => entry.open({ kind: 'salary-payment-reversal', record: r })}
                >
                  Reverse record
                </Btn>
              )}
          </>
        )}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        total={result.total}
        pageSize={20}
        onPage={setPage}
      />
    </div>
  );
}
