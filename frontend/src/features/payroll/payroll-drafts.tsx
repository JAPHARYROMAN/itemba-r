'use client';

import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { PageSpinner } from '@/components/ui';
import { WorkspaceDraftShelf, type WorkspaceDraft } from '@/components/workspace/workspace-drafts';
import {
  useUnsavedWork,
  useUnsavedWorkScopeId,
} from '@/components/workspace/unsaved-work-provider';
import { useAuth } from '@/hooks/use-auth';
import { backendGet } from '@/lib/api-client';
import type { Allocation, Kind as AllocationKind } from './allocation-types';
import type { Employee } from './employee-types';
import type { MobileMoney } from './mobile-money-types';
import {
  employeeSectionFields,
  employeeSensitiveFields,
  type EmployeeSection,
} from './employee-edit-values';
import { useWorkspaceState } from '@/components/workspace/workspace-session';

const EmployeeEditor = lazy(() =>
  import('./employee-create-editor').then((module) => ({ default: module.EmployeeCreateEditor })),
);
const AllocationEditor = lazy(() =>
  import('./employee-allocation-editor').then((module) => ({ default: module.AllocationEditor })),
);
const EmployeeEditEditor = lazy(() =>
  import('./employee-edit-editor').then((module) => ({ default: module.EmployeeEditEditor })),
);
const EmployeeTerminationEditor = lazy(() =>
  import('./employee-termination-editor').then((module) => ({
    default: module.EmployeeTerminationEditor,
  })),
);
const EmployeeMobileMoneyEditor = lazy(() =>
  import('./employee-mobile-money-editor').then((module) => ({
    default: module.EmployeeMobileMoneyEditor,
  })),
);

import type { Attendance } from './attendance-workflow';
import { type Contract, contractActionPermissions } from './contract-workflow';
import {
  type LeaveRequest,
  type Action as LeaveAction,
  leaveActionPermissions,
} from './leave-request-workflow';
import type { PeopleAction } from './people-action-editor';
const ContractEditor = lazy(() =>
  import('./contract-editor').then((module) => ({ default: module.ContractEditor })),
);
const AttendanceEditor = lazy(() =>
  import('./attendance-editor').then((module) => ({ default: module.AttendanceEditor })),
);
const LeaveRequestEditor = lazy(() =>
  import('./leave-request-editor').then((module) => ({ default: module.LeaveRequestEditor })),
);
const PeopleActionEditor = lazy(() =>
  import('./people-action-editor').then((module) => ({ default: module.PeopleActionEditor })),
);

import {
  type PayrollRunRecord,
  type PayrollAction,
  payrollActionLabels,
  payrollActionAllowed,
} from '@/components/workspace/payroll-types';
import type { SalaryAdvance } from './salary-advance-types';
import type { SalaryPayment } from './salary-payment-types';
const PayrollRunEditor = lazy(() =>
  import('./payroll-run-editor').then((module) => ({ default: module.PayrollRunEditor })),
);
const PayrollActionDialog = lazy(() =>
  import('./payroll-action-editor').then((module) => ({ default: module.PayrollActionDialog })),
);
const AdvanceForm = lazy(() =>
  import('./salary-advance-editors').then((module) => ({ default: module.AdvanceForm })),
);
const AdvanceAction = lazy(() =>
  import('./salary-advance-editors').then((module) => ({ default: module.AdvanceAction })),
);
const ReverseDialog = lazy(() =>
  import('./salary-payment-editors').then((module) => ({ default: module.ReverseDialog })),
);
import type { LeaveType } from './leave-type-workflow';
import type { LeaveBalanceRecord } from './leave-balance-editor';
import type { Assignment } from './assignment-workflow';
import type { Department } from './department-workflow';
import type { Position } from './position-workflow';
import type { PayrollType } from './payroll-type-workflow';
const DepartmentEditor = lazy(() =>
  import('./department-editor').then((module) => ({ default: module.DepartmentEditor })),
);
const PositionEditor = lazy(() =>
  import('./position-editor').then((module) => ({ default: module.PositionEditor })),
);
const TypeEditor = lazy(() =>
  import('./payroll-type-editor').then((module) => ({ default: module.TypeEditor })),
);
const PayrollPeriodEditor = lazy(() =>
  import('./payroll-period-editor').then((module) => ({ default: module.PayrollPeriodEditor })),
);
const LeaveTypeEditor = lazy(() =>
  import('./leave-type-editor').then((module) => ({ default: module.LeaveTypeEditor })),
);
const AllocationModal = lazy(() =>
  import('./leave-balance-editor').then((module) => ({ default: module.AllocationModal })),
);
const AssignmentEditor = lazy(() =>
  import('./assignment-editor').then((module) => ({ default: module.AssignmentEditor })),
);

type Kind =
  | 'department'
  | 'position'
  | 'allowance-type'
  | 'deduction-type'
  | 'payroll-period'
  | 'leave-type'
  | 'leave-balance'
  | 'assignment'
  | 'payroll-run'
  | 'payroll-action'
  | 'salary-advance'
  | 'advance-action'
  | 'salary-payment-reversal'
  | 'employee'
  | 'employee-edit'
  | 'termination'
  | 'mobile-money'
  | AllocationKind
  | 'contract'
  | 'attendance'
  | 'leave-request'
  | 'contract-action'
  | 'leave-action';
type Entry = (
  | { kind: 'department'; record?: Department; companyId?: string }
  | { kind: 'position'; record?: Position; companyId?: string }
  | { kind: 'allowance-type'; record?: PayrollType }
  | { kind: 'deduction-type'; record?: PayrollType }
  | { kind: 'payroll-period'; companyId?: string }
  | { kind: 'leave-type'; record?: LeaveType }
  | { kind: 'leave-balance'; record?: LeaveBalanceRecord }
  | { kind: 'assignment'; record?: Assignment }
  | { kind: 'payroll-run'; companyId?: string; periodId?: string }
  | { kind: 'payroll-action'; record: PayrollRunRecord; action: PayrollAction }
  | { kind: 'salary-advance' }
  | { kind: 'advance-action'; record: SalaryAdvance; action: 'approve' | 'pay' }
  | { kind: 'salary-payment-reversal'; record: SalaryPayment }
  | { kind: 'contract' }
  | { kind: 'leave-request' }
  | { kind: 'attendance'; record?: Attendance }
  | PeopleAction
  | { kind: 'employee'; companyId?: string }
  | { kind: 'employee-edit'; record: Employee; section: EmployeeSection }
  | { kind: 'termination'; employee: Employee }
  | { kind: 'mobile-money'; employee: Employee; record?: MobileMoney; accounts?: MobileMoney[] }
  | { kind: AllocationKind; record?: Allocation }
) & { source?: WorkspaceDraft };
const permissions: Record<Kind, string> = {
  department: 'departments.manage',
  position: 'positions.manage',
  'allowance-type': 'allowances.manage',
  'deduction-type': 'deductions.manage',
  'payroll-period': 'payroll.manage',
  'leave-type': 'leave_types.manage',
  'leave-balance': 'leave_balances.manage',
  assignment: 'employees.assignments.manage',
  'payroll-run': 'payroll.manage',
  'payroll-action': 'payroll.view',
  'salary-advance': 'salary_advances.create',
  'advance-action': 'salary_advances.view',
  'salary-payment-reversal': 'salary_payments.reverse',
  contract: 'employment_contracts.create',
  attendance: 'attendance.create',
  'leave-request': 'leave_requests.create',
  'contract-action': 'employment_contracts.view',
  'leave-action': 'leave_requests.view',
  employee: 'employees.create',
  'employee-edit': 'employees.update',
  termination: 'employees.termination.request',
  'mobile-money': 'employees.update',
  allowance: 'allowances.manage',
  deduction: 'deductions.manage',
};
const Context = createContext<{ open: (entry: Entry) => void; revision: number } | null>(null);

export function usePayrollStateKey(view: string) {
  const scope = useUnsavedWorkScopeId();
  return `payroll.${scope || 'main'}.${view}`;
}

function useDraftController(onSaved: (message: string) => void, viewKey?: string) {
  const { hasPermission } = useAuth();
  const permission = useRef(hasPermission);
  useLayoutEffect(() => {
    permission.current = hasPermission;
  }, [hasPermission]);
  const canOpen = (kind: Kind, details: { recordId?: string; action?: string } = {}) => {
    if (kind === 'payroll-action')
      return (
        !!details.action &&
        Object.hasOwn(payrollActionLabels, details.action) &&
        permission.current('payroll.view') &&
        payrollActionAllowed(details.action as PayrollAction, permission.current)
      );
    let required = permissions[kind];
    if (kind === 'advance-action') {
      if (!['approve', 'pay'].includes(details.action || '')) return false;
      required = 'salary_advances.' + details.action;
    }
    if (kind === 'attendance' && details.recordId) required = 'attendance.update';
    if (kind === 'contract-action') {
      if (!details.action || !Object.hasOwn(contractActionPermissions, details.action))
        return false;
      required =
        contractActionPermissions[details.action as keyof typeof contractActionPermissions];
    }
    if (kind === 'leave-action') {
      if (!details.action || !Object.hasOwn(leaveActionPermissions, details.action)) return false;
      required = leaveActionPermissions[details.action as LeaveAction];
    }
    const definitionViews = {
      department: 'departments.view',
      position: 'positions.view',
      'allowance-type': 'allowances.view',
      'deduction-type': 'deductions.view',
    };
    const view = Object.hasOwn(definitionViews, kind)
      ? definitionViews[kind as keyof typeof definitionViews]
      : kind === 'leave-type'
        ? 'leave_types.view'
        : kind === 'leave-balance'
          ? 'leave_balances.view'
          : kind === 'payroll-run' || kind === 'payroll-period'
            ? 'payroll.view'
            : kind === 'salary-advance' || kind === 'advance-action'
              ? 'salary_advances.view'
              : kind === 'salary-payment-reversal'
                ? 'salary_payments.view'
                : kind === 'contract' || kind === 'contract-action'
                  ? 'employment_contracts.view'
                  : kind === 'leave-request' || kind === 'leave-action'
                    ? 'leave_requests.view'
                    : kind === 'attendance'
                      ? 'attendance.view'
                      : ['employee-edit', 'termination', 'mobile-money'].includes(kind)
                        ? 'employees.view'
                        : '';
    return permission.current(required) && (!view || permission.current(view));
  };
  const { request } = useUnsavedWork();
  const scope = useUnsavedWorkScopeId();
  const [editor, setEditor] = useState<(Entry & { key: string }) | null>(null);
  const reader = useRef<AbortController | null>(null);
  const previousView = useRef(viewKey);
  useEffect(() => () => reader.current?.abort(), []);
  useEffect(() => {
    if (previousView.current === viewKey) return;
    previousView.current = viewKey;
    reader.current?.abort();
    setEditor(null);
  }, [viewKey]);
  const open = (entry: Entry) => {
    if (
      !canOpen(entry.kind, {
        recordId: 'record' in entry ? entry.record?.id : undefined,
        action: 'action' in entry ? entry.action : undefined,
      })
    )
      throw new Error('Your current role cannot open this Payroll draft.');
    reader.current?.abort();
    request(
      () => setEditor({ ...entry, key: entry.source?.id ?? crypto.randomUUID() }),
      undefined,
      'close',
      { scope },
    );
  };
  const resume = async (source: WorkspaceDraft) => {
    const kind = source.context.kind as Kind;
    if (!Object.hasOwn(permissions, kind) || !canOpen(kind, source.context))
      throw new Error('Your current role cannot open this Payroll draft.');
    if (kind === 'payroll-period') {
      open({ kind, source });
      return;
    }
    if (kind === 'salary-advance') {
      open({ kind, source });
      return;
    }
    if (kind === 'payroll-run') {
      open({ kind, source, companyId: source.context.companyId });
      return;
    }
    if (kind === 'contract' || kind === 'leave-request') {
      open({ kind, source });
      return;
    }
    if (kind === 'employee') {
      open({ kind, companyId: source.context.companyId, source });
      return;
    }
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    try {
      if (
        kind === 'department' ||
        kind === 'position' ||
        kind === 'allowance-type' ||
        kind === 'deduction-type'
      ) {
        const id = source.context.recordId;
        if (kind === 'department') {
          const record = id
            ? await backendGet<Department>(`/hr/departments/${encodeURIComponent(id)}`, {
                signal: controller.signal,
              })
            : undefined;
          if (!controller.signal.aborted) open({ kind, record, source });
        } else if (kind === 'position') {
          const record = id
            ? await backendGet<Position>(`/hr/positions/${encodeURIComponent(id)}`, {
                signal: controller.signal,
              })
            : undefined;
          if (!controller.signal.aborted) open({ kind, record, source });
        } else {
          const record = id
            ? await backendGet<PayrollType>(`/hr/${kind}s/${encodeURIComponent(id)}`, {
                signal: controller.signal,
              })
            : undefined;
          if (!controller.signal.aborted) open({ kind, record, source });
        }
        return;
      }
      if (kind === 'leave-type' || kind === 'leave-balance' || kind === 'assignment') {
        const id = source.context.recordId;
        if (kind === 'leave-type') {
          const record = id
            ? await backendGet<LeaveType>(`/hr/leave-types/${encodeURIComponent(id)}`, {
                signal: controller.signal,
              })
            : undefined;
          if (!controller.signal.aborted) open({ kind, record, source });
        } else if (kind === 'leave-balance') {
          const record = id
            ? await backendGet<LeaveBalanceRecord>(`/hr/leave-balances/${encodeURIComponent(id)}`, {
                signal: controller.signal,
              })
            : undefined;
          if (!controller.signal.aborted) open({ kind, record, source });
        } else {
          const record = id
            ? await backendGet<Assignment>(`/hr/employee-assignments/${encodeURIComponent(id)}`, {
                signal: controller.signal,
              })
            : undefined;
          if (!controller.signal.aborted) open({ kind, record, source });
        }
        return;
      }
      if (
        kind === 'payroll-action' ||
        kind === 'advance-action' ||
        kind === 'salary-payment-reversal'
      ) {
        const id = source.context.recordId;
        if (!id) throw new Error('This draft is missing its source record.');
        if (kind === 'payroll-action') {
          const record = await backendGet<PayrollRunRecord>(
            `/hr/payroll-runs/${encodeURIComponent(id)}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted)
            open({ kind, record, action: source.context.action as PayrollAction, source });
        } else if (kind === 'advance-action') {
          const record = await backendGet<SalaryAdvance>(
            `/hr/salary-advances/${encodeURIComponent(id)}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted)
            open({ kind, record, action: source.context.action as 'approve' | 'pay', source });
        } else {
          const record = await backendGet<SalaryPayment>(
            `/hr/salary-payments/${encodeURIComponent(id)}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) open({ kind: 'salary-payment-reversal', record, source });
        }
        return;
      }
      if (kind === 'attendance') {
        const record = source.context.recordId
          ? await backendGet<Attendance>(
              `/hr/attendance/${encodeURIComponent(source.context.recordId)}`,
              { signal: controller.signal },
            )
          : undefined;
        if (!controller.signal.aborted) open({ kind, record, source });
        return;
      }
      if (kind === 'contract-action' || kind === 'leave-action') {
        if (!source.context.recordId) throw new Error('This draft is missing its source record.');
        if (kind === 'contract-action') {
          const record = await backendGet<Contract>(
            `/hr/employment-contracts/${encodeURIComponent(source.context.recordId)}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted)
            open({
              kind,
              record,
              action: source.context.action as keyof typeof contractActionPermissions,
              source,
            });
        } else {
          const record = await backendGet<LeaveRequest>(
            `/hr/leave-requests/${encodeURIComponent(source.context.recordId)}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted)
            open({ kind, record, action: source.context.action as LeaveAction, source });
        }
        return;
      }
      if (kind === 'termination' || kind === 'mobile-money') {
        const employeeId = source.context.employeeId;
        if (!employeeId) throw new Error('This draft is missing its employee.');
        const [employee, accounts] = await Promise.all([
          backendGet<Employee>(`/hr/employees/${encodeURIComponent(employeeId)}`, {
            signal: controller.signal,
          }),
          kind === 'mobile-money'
            ? backendGet<MobileMoney[]>('/hr/mobile-money-accounts', {
                query: { employeeId },
                signal: controller.signal,
              })
            : Promise.resolve([]),
        ]);
        if (controller.signal.aborted) return;
        if (kind === 'termination') open({ kind, employee, source });
        else {
          const record = accounts.find((row) => row.id === source.context.recordId);
          if (source.context.recordId && !record)
            throw new Error(
              'This mobile money account is no longer available. Your draft is still kept.',
            );
          open({ kind, employee, record, accounts, source });
        }
        return;
      }
      if (kind === 'employee-edit') {
        const section = source.context.section as EmployeeSection;
        const values = source.values;
        if (
          !source.context.recordId ||
          !Object.hasOwn(employeeSectionFields, section) ||
          !values ||
          typeof values !== 'object'
        )
          throw new Error('This employee draft is missing its source record or section.');
        if (
          !permission.current('employees.sensitive.view') &&
          !permission.current('payroll.sensitive.view') &&
          employeeSensitiveFields.some((field) => Object.hasOwn(values, field))
        )
          throw new Error(
            'Your current role cannot access the sensitive fields in this employee draft.',
          );
        const record = await backendGet<Employee>(
          `/hr/employees/${encodeURIComponent(source.context.recordId)}`,
          {
            signal: controller.signal,
          },
        );
        if (!controller.signal.aborted) open({ kind, record, section, source });
        return;
      }
      const record = source.context.recordId
        ? await backendGet<Allocation>(
            `/hr/employee-${kind}s/${encodeURIComponent(source.context.recordId)}`,
            { signal: controller.signal },
          )
        : undefined;
      if (!controller.signal.aborted) open({ kind, record, source });
    } catch (cause) {
      if (!controller.signal.aborted) throw cause;
    }
  };
  const close = () => setEditor(null);
  const saved = (message: string) => {
    close();
    onSaved(message);
  };
  const form = editor && (
    <Suspense fallback={<PageSpinner label="Opening Payroll draft" />}>
      {editor.kind === 'department' ? (
        <DepartmentEditor
          key={editor.key}
          record={editor.record}
          companyId={editor.companyId}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'position' ? (
        <PositionEditor
          key={editor.key}
          record={editor.record}
          companyId={editor.companyId}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'allowance-type' || editor.kind === 'deduction-type' ? (
        <TypeEditor
          key={editor.key}
          kind={editor.kind === 'allowance-type' ? 'allowance' : 'deduction'}
          record={editor.record}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'payroll-period' ? (
        <PayrollPeriodEditor
          key={editor.key}
          companyId={editor.companyId}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'leave-type' ? (
        <LeaveTypeEditor
          key={editor.key}
          record={editor.record}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'leave-balance' ? (
        <AllocationModal
          key={editor.key}
          initial={editor.record}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'assignment' ? (
        <AssignmentEditor
          key={editor.key}
          record={editor.record}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'payroll-run' ? (
        <PayrollRunEditor
          key={editor.key}
          companyId={editor.companyId}
          periodId={editor.periodId}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'payroll-action' ? (
        <PayrollActionDialog
          key={editor.key}
          run={editor.record}
          action={editor.action}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'salary-advance' ? (
        <AdvanceForm key={editor.key} source={editor.source} onClose={close} onSaved={saved} />
      ) : editor.kind === 'advance-action' ? (
        <AdvanceAction
          key={editor.key}
          advance={editor.record}
          kind={editor.action}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'salary-payment-reversal' ? (
        <ReverseDialog
          key={editor.key}
          payment={editor.record}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'contract' ? (
        <ContractEditor key={editor.key} source={editor.source} onClose={close} onSaved={saved} />
      ) : editor.kind === 'leave-request' ? (
        <LeaveRequestEditor
          key={editor.key}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'attendance' ? (
        <AttendanceEditor
          key={editor.key}
          record={editor.record}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'contract-action' || editor.kind === 'leave-action' ? (
        <PeopleActionEditor
          key={editor.key}
          entry={editor}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'employee' ? (
        <EmployeeEditor
          key={editor.key}
          companyId={editor.companyId}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'employee-edit' ? (
        <EmployeeEditEditor
          key={editor.key}
          record={editor.record}
          section={editor.section}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'termination' ? (
        <EmployeeTerminationEditor
          key={editor.key}
          employee={editor.employee}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'mobile-money' ? (
        <EmployeeMobileMoneyEditor
          key={editor.key}
          employee={editor.employee}
          record={editor.record}
          accounts={editor.accounts}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : (
        <AllocationEditor
          key={editor.key}
          kind={editor.kind}
          record={editor.record}
          source={editor.source}
          onClose={close}
          onSaved={saved}
        />
      )}
    </Suspense>
  );
  return { open, resume, form, activeDraftId: editor?.source?.id };
}

/** One shelf and editor across Payroll routes; drafts remain in the account session. */
export function PayrollDraftWorkspace({
  children,
  viewKey,
}: {
  children: ReactNode;
  viewKey: string;
}) {
  const [revision, setRevision] = useWorkspaceState('payroll.recordsRevision', 0);
  const [notice, setNotice] = useState('');
  const controller = useDraftController((message) => {
    setNotice(message);
    setRevision((value) => value + 1);
  }, viewKey);
  return (
    <Context.Provider value={{ open: controller.open, revision }}>
      <WorkspaceDraftShelf
        appId="payroll"
        onResume={controller.resume}
        activeDraftId={controller.activeDraftId}
      />
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {children}
      {controller.form}
    </Context.Provider>
  );
}

/** Standalone registers retain the same editor with a workflow-specific shelf. */
export function usePayrollDraftEditor(
  kind: Kind | readonly Kind[],
  onSaved: (message: string) => void,
  filter?: (draft: WorkspaceDraft) => boolean,
  viewKey?: string,
) {
  const parent = useContext(Context);
  const [localRevision, setLocalRevision] = useWorkspaceState('payroll.recordsRevision', 0);
  const savedMessage = useRef<string | null>(null);
  const local = useDraftController((message) => {
    savedMessage.current = message;
    setLocalRevision((value) => value + 1);
  }, viewKey);
  const revision = parent?.revision ?? localRevision;
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    onSaved(savedMessage.current || 'Payroll records updated.');
    savedMessage.current = null;
  }, [revision, onSaved]);
  return {
    open: parent?.open ?? local.open,
    drafts: parent ? null : (
      <>
        <WorkspaceDraftShelf
          appId="payroll"
          onResume={local.resume}
          activeDraftId={local.activeDraftId}
          filter={(draft) =>
            (typeof kind === 'string'
              ? draft.context.kind === kind
              : kind.includes(draft.context.kind as Kind)) &&
            (!filter || filter(draft))
          }
        />
        {local.form}
      </>
    ),
  };
}
