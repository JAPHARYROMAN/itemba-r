'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Btn,
  Card,
  PageHeader,
  PageSpinner,
  PermissionDeniedState,
  StatusBadge,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { DisputeEditor } from './dispute-editor';
import { DisputeOperationDialog } from './dispute-operation';
import {
  disputeClosed,
  disputeDate,
  disputeEmployeeName,
  disputeLabel,
  disputeOperationAllowed,
  disputePath,
  type DisputeOperation,
  type DisputeRecord,
} from './dispute-types';
import { payrollMoney } from './payroll-types';
import './workspace.css';
export function DisputeDetailWorkspace({ id }: { id: string }) {
  const { hasPermission } = useAuth();
  const canRead = hasPermission('employees.view'),
    canUpdate = hasPermission('employees.update'),
    canDelete = hasPermission('employees.delete');
  const result = useWorkspaceResource<DisputeRecord>(disputePath + '/' + id, {}, canRead && !!id),
    router = useRouter();
  const [editing, setEditing] = useState(false),
    [operation, setOperation] = useState<DisputeOperation | null>(null),
    [notice, setNotice] = useState('');
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view employment disputes." />;
  const header = (
    <PageHeader
      title={result.data ? 'Dispute ' + result.data.disputeNumber : 'Employment dispute'}
      subtitle={
        result.data
          ? disputeEmployeeName(result.data.employee) + ' · ' + disputeLabel(result.data.type)
          : 'Review the record and its workflow.'
      }
      breadcrumbs={[
        { label: 'People', href: '/hr' },
        { label: 'Disputes', href: '/hr/disputes' },
        { label: result.data?.disputeNumber || 'Details' },
      ]}
      actions={
        <Link className="workspace-secondary-link" href="/hr/disputes">
          All disputes
        </Link>
      }
    />
  );
  if (result.loading)
    return (
      <div className="business-workspace">
        {header}
        <PageSpinner />
      </div>
    );
  if (result.error || !result.data)
    return (
      <div className="business-workspace">
        {header}
        <div role="alert" className="workspace-notice">
          <p>{result.error || 'Dispute not found.'}</p>
          <Btn variant="secondary" onClick={result.reload}>
            Try again
          </Btn>
        </div>
      </div>
    );
  return (
    <DisputeContent
      key={id}
      record={result.data}
      header={header}
      canUpdate={canUpdate}
      canDelete={canDelete}
      editing={editing}
      operation={operation}
      notice={notice}
      setEditing={setEditing}
      setOperation={setOperation}
      onSaved={(message, deleted) => {
        setEditing(false);
        setOperation(null);
        if (deleted) {
          router.push('/hr/disputes');
          return;
        }
        setNotice(message);
        result.reload();
      }}
    />
  );
}
function DisputeContent({
  record: r,
  header,
  canUpdate,
  canDelete,
  editing,
  operation,
  notice,
  setEditing,
  setOperation,
  onSaved,
}: {
  record: DisputeRecord;
  header: ReactNode;
  canUpdate: boolean;
  canDelete: boolean;
  editing: boolean;
  operation: DisputeOperation | null;
  notice: string;
  setEditing: (v: boolean) => void;
  setOperation: (v: DisputeOperation | null) => void;
  onSaved: (message: string, deleted?: boolean) => void;
}) {
  const { hasPermission } = useAuth();
  return (
    <div className="business-workspace space-y-5">
      {header}
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      <Card className="p-5">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="space-y-2">
            <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Current status
            </p>
            <StatusBadge status={r.status} />
          </div>
          <div className="flex flex-wrap gap-2">
            {canUpdate && !disputeClosed(r) && (
              <Btn variant="secondary" onClick={() => setEditing(true)}>
                Edit dispute
              </Btn>
            )}
            {canUpdate && disputeOperationAllowed(r, 'mediate') && (
              <Btn variant="primary" onClick={() => setOperation('mediate')}>
                Start mediation
              </Btn>
            )}
            {canUpdate && disputeOperationAllowed(r, 'refer-cma') && (
              <Btn variant="secondary" onClick={() => setOperation('refer-cma')}>
                Record CMA referral
              </Btn>
            )}
            {canUpdate && !disputeClosed(r) && (
              <>
                <Btn variant="secondary" onClick={() => setOperation('resolve')}>
                  Record resolution
                </Btn>
                <Btn variant="ghost" onClick={() => setOperation('withdraw')}>
                  Withdraw
                </Btn>
              </>
            )}
            {canDelete && (
              <Btn variant="ghost" onClick={() => setOperation('delete')}>
                Delete record
              </Btn>
            )}
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card className="p-5 min-w-0 space-y-4">
          <h2 className="text-lg font-semibold">Dispute details</h2>
          <Details
            rows={[
              ['Employee', disputeEmployeeName(r.employee)],
              ['Employee code', r.employee?.employeeCode],
              ['Company', r.company?.name],
              ['Division', r.division?.name],
              ['Branch', r.branch?.name],
              ['Department', r.employee?.department?.name],
              ['Position', r.employee?.position?.title],
              ['Type', disputeLabel(r.type)],
              ['Raised', disputeDate(r.raisedAt)],
              ['Raised by', r.raisedBy?.fullName],
              ['Summary', r.summary],
              ['Initial position', r.initialPosition],
              ['Notes', r.notes],
              ...(r.directToGroupHr
                ? [['Route', 'Direct to Group HR'] as [string, ReactNode]]
                : []),
            ]}
          />
        </Card>
        <Card className="p-5 min-w-0 space-y-5">
          <h2 className="text-lg font-semibold">Workflow history</h2>
          <section className="space-y-3">
            <h3 className="font-semibold">Internal mediation</h3>
            {r.mediatedAt || r.mediationOutcome || r.mediatedBy ? (
              <Details
                rows={[
                  ['Started', disputeDate(r.mediatedAt)],
                  ['Recorded by', r.mediatedBy?.fullName],
                  ['Outcome', r.mediationOutcome],
                ]}
              />
            ) : (
              <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                No mediation recorded.
              </p>
            )}
          </section>
          <section className="space-y-3">
            <h3 className="font-semibold">CMA referral</h3>
            {r.cmaReferredAt || r.cmaReferenceNumber || r.cmaHearingDate || r.cmaArbitrator ? (
              <Details
                rows={[
                  ['Referred', disputeDate(r.cmaReferredAt)],
                  ['Recorded by', r.cmaReferredBy?.fullName],
                  ['Reference', r.cmaReferenceNumber],
                  ['Arbitrator', r.cmaArbitrator],
                  ['Hearing date', r.cmaHearingDate ? disputeDate(r.cmaHearingDate) : null],
                ]}
              />
            ) : (
              <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                No referral recorded.
              </p>
            )}
            {r.status === 'CMA_REFERRED' && (
              <Link
                className="workspace-secondary-link"
                href={'/hr/ccm-notices/cma-referral/' + r.id}
              >
                Open CMA referral form
              </Link>
            )}
          </section>
          <section className="space-y-3">
            <h3 className="font-semibold">Resolution</h3>
            {r.resolvedAt || r.resolutionType || r.resolutionAmount != null || r.resolutionNotes ? (
              <Details
                rows={[
                  ['Closed', disputeDate(r.resolvedAt)],
                  ['Recorded by', r.resolvedBy?.fullName],
                  [
                    'Outcome',
                    r.resolutionType ? disputeLabel(r.resolutionType) : disputeLabel(r.status),
                  ],
                  [
                    'Recorded amount',
                    r.resolutionAmount == null ? null : payrollMoney(r.resolutionAmount),
                  ],
                  ['Resolution notes', r.resolutionNotes],
                ]}
              />
            ) : (
              <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                No resolution recorded.
              </p>
            )}
          </section>
        </Card>
      </div>
      {hasPermission('disciplinary_actions.view') && (
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <h2 className="text-lg font-semibold">Linked disciplinary actions</h2>
            <Link className="workspace-secondary-link" href="/hr/disciplinary-actions">
              Open actions
            </Link>
          </div>
          {r.disciplinaryActions?.length ? (
            <ul className="space-y-3">
              {r.disciplinaryActions.map((a) => (
                <li
                  className="rounded-lg p-4 space-y-2"
                  style={{ background: 'var(--aurora-bg-subtle)' }}
                  key={a.id}
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>{a.actionNumber}</strong>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="text-sm">
                    {disputeLabel(a.type)} · {disputeDate(a.issuedAt)}
                  </p>
                  <p className="text-sm whitespace-pre-wrap break-words">{a.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              No disciplinary actions are linked to this dispute.
            </p>
          )}
        </Card>
      )}
      <Card className="p-5">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="space-y-2">
            <h2 className="font-semibold">Employee documents</h2>
            <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Open the existing termination notice workspace for this employee.
            </p>
          </div>
          <Link
            className="workspace-secondary-link"
            href={'/hr/ccm-notices/termination/' + r.employeeId}
          >
            Open termination form
          </Link>
        </div>
      </Card>
      {editing && !disputeClosed(r) && canUpdate && (
        <DisputeEditor
          record={r}
          onClose={() => setEditing(false)}
          onSaved={() => onSaved('Dispute saved.')}
        />
      )}
      {operation &&
        disputeOperationAllowed(r, operation) &&
        (operation === 'delete' ? canDelete : canUpdate) && (
          <DisputeOperationDialog
            key={operation}
            record={r}
            operation={operation}
            onClose={() => setOperation(null)}
            onSaved={(op) =>
              onSaved(
                {
                  mediate: 'Mediation recorded.',
                  'refer-cma': 'CMA referral recorded.',
                  resolve: 'Resolution recorded.',
                  withdraw: 'Dispute withdrawn.',
                  delete: 'Dispute deleted.',
                }[op],
                op === 'delete',
              )
            }
          />
        )}
    </div>
  );
}
function Details({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="space-y-3">
      {rows
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([label, value]) => (
          <div
            className="grid grid-cols-1 sm:grid-cols-[130px_minmax(0,1fr)] gap-1 sm:gap-4 text-sm"
            key={label}
          >
            <dt style={{ color: 'var(--aurora-text-muted)' }}>{label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd>
          </div>
        ))}
    </dl>
  );
}
