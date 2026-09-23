'use client';

import { useEffect } from 'react';
import { useWorkspaceState } from './workspace-session';
import { useUnsavedWorkScopeId } from './unsaved-work-provider';
import { RecordBrowser, type RecordField } from './record-browser';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useAuth } from '@/hooks/use-auth';
import { PermissionDeniedState } from '@/components/ui';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';

type RelatedRow = {
  id: string;
  [field: string]: unknown;
  company?: { name: string };
  department?: { name: string };
  position?: { title: string };
  leaveType?: { name: string };
  payrollRun?: { payrollRunNumber: string };
  document?: { title: string; fileName: string };
};
const value = (v: unknown) => (v == null || v === '' ? '—' : String(v).replaceAll('_', ' '));
const date = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-GB') : '—');
const field = (label: string, key: string, format = value): RecordField<RelatedRow> => ({
  label,
  value: (row) => format(row[key]),
});
const configurations = {
  assignments: {
    path: 'employee-assignments',
    permission: 'employees.assignments.manage',
    title: 'Assignments',
    name: (row: RelatedRow) =>
      row.position?.title || row.department?.name || row.company?.name || 'Assignment',
    fields: [
      { label: 'Company', value: (row: RelatedRow) => row.company?.name || '—' },
      field('From', 'startDate', date),
    ],
    details: [
      field('Until', 'endDate', date),
      field('Approval', 'approvalStatus'),
      { label: 'Department', value: (row: RelatedRow) => row.department?.name || '—' },
    ],
  },
  contracts: {
    path: 'employment-contracts',
    permission: 'employment_contracts.view',
    title: 'Contracts',
    name: (row: RelatedRow) => String(row.contractCode || 'Employment contract'),
    fields: [field('Type', 'contractType'), field('From', 'startDate', date)],
    details: [field('Until', 'endDate', date), field('Probation ends', 'probationEndDate', date)],
  },
  attendance: {
    path: 'attendance',
    permission: 'attendance.view',
    title: 'Attendance',
    name: (row: RelatedRow) => date(row.attendanceDate),
    fields: [field('Hours', 'totalHours'), field('Overtime hours', 'overtimeHours')],
    details: [
      field('Reference', 'attendanceNumber'),
      field('Late minutes', 'lateMinutes'),
      field('Source', 'source'),
    ],
  },
  leave: {
    path: 'leave-requests',
    permission: 'leave_requests.view',
    title: 'Leave requests',
    name: (row: RelatedRow) =>
      row.leaveType?.name || String(row.leaveRequestNumber || 'Leave request'),
    fields: [field('From', 'startDate', date), field('Until', 'endDate', date)],
    details: [
      field('Reference', 'leaveRequestNumber'),
      field('Days', 'totalDays'),
      field('Reason', 'reason'),
    ],
  },
  payroll: {
    path: 'payroll-entries',
    permission: 'payroll.view',
    title: 'Payroll history',
    name: (row: RelatedRow) => row.payrollRun?.payrollRunNumber || 'Payroll entry',
    fields: [field('Gross pay', 'grossPay'), field('Net pay', 'netPay')],
    details: [
      field('Base pay', 'basePay'),
      field('Allowances', 'totalAllowances'),
      field('Deductions', 'totalDeductions'),
      field('Days worked', 'daysWorked'),
    ],
  },
  documents: {
    path: 'documents',
    permission: 'hr_documents.view',
    title: 'Employee documents',
    name: (row: RelatedRow) => row.document?.title || String(row.title || 'Employee document'),
    fields: [field('Category', 'documentCategory'), field('Added', 'createdAt', date)],
    details: [
      { label: 'File', value: (row: RelatedRow) => row.document?.fileName || '—' },
      field('Notes', 'notes'),
    ],
  },
};
export type EmployeeRelatedSection = keyof typeof configurations;

/** Reads the employee-scoped collection, only when the corresponding tab is mounted. */
export function EmployeeRelatedRecords({
  employeeId,
  section,
}: {
  employeeId: string;
  section: EmployeeRelatedSection;
}) {
  const config = configurations[section];
  const { hasPermission } = useAuth();
  const allowed = hasPermission(config.permission);
  const scope = useUnsavedWorkScopeId();
  const stateKey = `payroll.${scope || 'main'}.employee.${employeeId}.${section}`;
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const result = useWorkspaceRecords<RelatedRow>(
    `/hr/${config.path}`,
    { employeeId, page, limit: 20 },
    allowed,
  );
  useEffect(() => {
    if (!result.loading && !result.error && page > 1 && !result.rows.length)
      setPage(Math.max(1, Math.ceil(result.total / 20)));
  }, [result.loading, result.error, result.rows.length, result.total, page, setPage]);
  if (!allowed)
    return (
      <PermissionDeniedState description={`Your role cannot view ${config.title.toLowerCase()}.`} />
    );
  return (
    <div className="space-y-4">
      {(section !== 'documents' || hasPermission('documents.view')) && (
        <div className="flex justify-end">
          <Link
            className="text-sm hover:underline"
            href={section === 'documents' ? '/group-control/documents' : `/hr/${config.path}`}
          >
            {section === 'documents'
              ? 'Open documents vault'
              : `Open ${config.title.toLowerCase()} workspace`}
          </Link>
        </div>
      )}
      <RecordBrowser
        stateKey={stateKey + '.selection'}
        selectionScope={String(page)}
        records={result.rows}
        title={config.title}
        name={config.name}
        status={(row) => String(row.attendanceStatus || row.status || '')}
        fields={config.fields}
        details={config.details}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        total={result.total}
        pageSize={20}
        onPage={setPage}
        empty={`No ${config.title.toLowerCase()} found for this employee.`}
      />
    </div>
  );
}
