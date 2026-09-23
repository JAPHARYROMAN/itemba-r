'use client';

import { printWorkspace } from '@/components/workspace/print-workspace';
import { Btn, PageHeader, PageSpinner, PermissionDeniedState } from '@/components/ui';
import { DocumentArtifactButton } from '@/components/documents';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import { PayslipPaper, type PayslipPayload } from './payslip-paper';
import '@/components/workspace/workspace.css';
import '@/components/workspace/payslip.css';

/**
 * Bilingual (English / Swahili) printable payslip. Uses CSS print styles so
 * the operator hits "Print" and gets a clean A4 PDF via the browser. No
 * server-side PDF dependency required for the MVP. Long allowance lists split
 * onto a continuation sheet so page 1 still carries gross, deductions and net.
 */

export function PayslipDetail({ payslipId: id }: { payslipId: string }) {
  const router = useGuardedRouter();
  const { hasPermission } = useAuth();
  const canRead = hasPermission('payroll.view');
  const { data, loading, error, reload } = useWorkspaceResource<PayslipPayload>(
    '/hr/payslips/' + encodeURIComponent(id),
    {},
    canRead,
  );

  if (!canRead) return <PermissionDeniedState description="Your role cannot view this payslip." />;
  if (loading) return <PageSpinner />;
  if (error || !data) {
    return (
      <div className="business-workspace">
        <PageHeader
          title="Payslip"
          breadcrumbs={[
            { label: 'Payroll', href: '/payroll' },
            { label: 'Payroll runs', href: '/hr/payroll-runs' },
            { label: 'Payslip' },
          ]}
        />
        <div role="alert" className="workspace-notice">
          {error || 'Payslip not found.'}
          <Btn variant="ghost" onClick={reload}>
            Try again
          </Btn>
        </div>
      </div>
    );
  }

  const { employee, payrollRun } = data;

  return (
    <>
      <style>{`
        @media print {
          .payslip-paper { margin: 0; box-shadow: none; }
          .payslip-workspace .no-print { display: none !important; }
        }
        .payslip-paper {
          font-family: 'Inter', system-ui, sans-serif;
          color: #1f2937;
          background: white;
        }
        .payslip-table { width: 100%; border-collapse: collapse; }
        .payslip-table td, .payslip-table th { padding: 6px 10px; font-size: 12px; }
        .payslip-table thead th {
          background: #f3f4f6;
          text-align: left;
          font-weight: 600;
          color: #4b5563;
          border-bottom: 1px solid #e5e7eb;
        }
        .payslip-table tbody td { border-bottom: 1px solid #f3f4f6; }
        .payslip-totals td { font-weight: 600; }
      `}</style>

      <div className="business-workspace payslip-workspace space-y-4">
        <div className="no-print">
          <PageHeader
            title="Payslip"
            subtitle={employee.fullName + ' · ' + payrollRun.payrollRunNumber}
            breadcrumbs={[
              { label: 'Payroll', href: '/payroll' },
              { label: 'Payroll runs', href: '/hr/payroll-runs' },
              ...(payrollRun.id
                ? [
                    {
                      label: 'Payslips',
                      href: '/hr/payroll-runs/' + encodeURIComponent(payrollRun.id) + '/payslips',
                    },
                  ]
                : []),
              { label: employee.employeeCode },
            ]}
            actions={
              <>
                {payrollRun.id && (
                  <Btn
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      router.push(
                        '/hr/payroll-runs/' + encodeURIComponent(payrollRun.id!) + '/payslips',
                      )
                    }
                  >
                    All payslips
                  </Btn>
                )}
                {hasPermission('payroll.view') && (
                  <DocumentArtifactButton entityType="PAYSLIP" entityId={id} />
                )}
                <Btn
                  variant="primary"
                  size="sm"
                  onClick={(event) => printWorkspace(event.currentTarget)}
                >
                  Print / Save as PDF
                </Btn>
              </>
            }
          />
        </div>

        <PayslipPaper data={data} />
      </div>
    </>
  );
}
