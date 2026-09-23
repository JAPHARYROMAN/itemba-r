'use client';
import { useEffect, useState } from 'react';
import { Btn, PageHeader, PageToolbar, PermissionDeniedState } from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import { payrollMoney } from '@/components/workspace/payroll-types';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useAuth } from '@/hooks/use-auth';
import '@/components/workspace/workspace.css';

interface PayslipRow {
  id: string;
  basePay: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  status: string;
  employee: {
    employeeCode: string;
    fullName: string;
    department?: { name: string } | null;
    position?: { title: string } | null;
  };
}
interface PayslipWorkspace {
  data: PayslipRow[];
  total: number;
  run: { payrollRunNumber: string; company?: { name: string }; payrollPeriod?: { name: string } };
  totals: { employees: number; gross: number; deductions: number; net: number };
}
export function RunPayslips({ runId: id }: { runId: string }) {
  const { hasPermission } = useAuth();
  const router = useGuardedRouter();
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
    setSearch('');
    setQuery('');
  }, [id]);
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query]);
  const canRead = hasPermission('payroll.view');
  const result = useWorkspaceResource<PayslipWorkspace>(
    '/hr/payslips/run/' + encodeURIComponent(id),
    { page, limit: 20, search: query },
    canRead,
  );
  if (!canRead) return <PermissionDeniedState description="Your role cannot view payslips." />;
  const data = result.data;
  return (
    <div className="business-workspace record-workspace">
      <PageHeader
        title="Payslips"
        subtitle={
          data
            ? [data.run.payrollRunNumber, data.run.payrollPeriod?.name, data.run.company?.name]
                .filter(Boolean)
                .join(' · ')
            : 'Review employee pay and open printable payslips.'
        }
        breadcrumbs={[
          { label: 'Payroll', href: '/payroll' },
          { label: 'Payroll runs', href: '/hr/payroll-runs' },
          { label: 'Payslips' },
        ]}
        actions={
          <Btn
            variant="secondary"
            onClick={() =>
              router.push('/hr/payroll-entries?payrollRunId=' + encodeURIComponent(id))
            }
          >
            View entries
          </Btn>
        }
      />
      {data && (
        <div className="workspace-summary payroll-run-summary" aria-label="Whole run totals">
          <div>
            <span>Employees in run</span>
            <strong>{data.totals.employees}</strong>
          </div>
          <div>
            <span>Run gross pay</span>
            <strong>{payrollMoney(data.totals.gross)}</strong>
          </div>
          <div>
            <span>Run deductions</span>
            <strong>{payrollMoney(data.totals.deductions)}</strong>
          </div>
          <div>
            <span>Run net pay</span>
            <strong>{payrollMoney(data.totals.net)}</strong>
          </div>
        </div>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search employee name or code…"
        actions={
          <Btn variant="secondary" disabled={result.loading} onClick={result.reload}>
            Reload
          </Btn>
        }
      />
      <RecordBrowser
        title="Payslips"
        records={data?.data ?? []}
        name={(r) => r.employee.fullName}
        reference={(r) => r.employee.employeeCode}
        status={(r) => r.status}
        fields={[
          { label: 'Gross pay', value: (r) => payrollMoney(r.grossPay) },
          { label: 'Net pay', value: (r) => payrollMoney(r.netPay) },
        ]}
        details={[
          { label: 'Department', value: (r) => r.employee.department?.name || '—' },
          { label: 'Position', value: (r) => r.employee.position?.title || '—' },
          { label: 'Base pay', value: (r) => payrollMoney(r.basePay) },
          { label: 'Deductions', value: (r) => payrollMoney(r.totalDeductions) },
        ]}
        actions={(r) => (
          <Btn
            variant="primary"
            onClick={() => router.push('/hr/payslips/' + encodeURIComponent(r.id))}
          >
            View payslip
          </Btn>
        )}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        total={data?.total ?? 0}
        pageSize={20}
        onPage={setPage}
        empty={
          query
            ? 'No employees match this search.'
            : 'No payslips in this run yet. Calculate the run to prepare employee entries.'
        }
      />
    </div>
  );
}
