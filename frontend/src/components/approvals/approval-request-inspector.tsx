'use client';
import { useState } from 'react';
import { FileText, X, ArrowLeft } from 'lucide-react';
import { Btn, StatusBadge } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { ApprovalRequestAction } from './approval-request-action';
import {
  type ApprovalRequest,
  type RequestAction,
  requestTitle,
  requestPath,
  requestAmount,
  requestDate,
  requestPerson,
} from './approval-request-types';

export function ApprovalRequestInspector({
  row,
  onClose,
  onSaved,
}: {
  row: ApprovalRequest;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user, hasPermission } = useAuth();
  const detail = useWorkspaceResource<ApprovalRequest>(
    `${requestPath}/${encodeURIComponent(row.id)}`,
  );
  const [action, setAction] = useState<RequestAction | null>(null);
  const record = detail.data?.id === row.id ? detail.data : row;
  const ready = detail.data?.id === row.id && !detail.loading && !detail.error;
  const own = user?.id === (record.requestedById || record.requestedBy?.id);
  const decisionAllowed = ready && record.status === 'PENDING' && !own;
  const primaryFields = [
    ['Company', record.company?.name || record.companyId || 'Group-level'],
    ['Amount', requestAmount(record)],
    ['Requested by', requestPerson(record)],
    ['Submitted', requestDate(record.submittedAt)],
    ['Due', requestDate(record.dueAt)],
    ['Reference', record.approvalRequestNumber || '—'],
  ];
  const fields = [
    ['Entity type', record.entityType || '—'],
    ['Entity reference', record.entityId || '—'],
    ['Action', record.actionType || '—'],
    ['Created', requestDate(record.createdAt)],
    ['Workflow', record.workflow?.name || 'No workflow assigned'],
    ['Current step', record.currentStepOrder == null ? '—' : String(record.currentStepOrder)],
    ['Risk level', record.riskLevel || 'Not recorded'],
    ['Updated', requestDate(record.updatedAt)],
    ...(record.approvedAt ? [['Approved', requestDate(record.approvedAt)]] : []),
    ...(record.rejectedAt ? [['Rejected', requestDate(record.rejectedAt)]] : []),
    ...(record.cancelledAt ? [['Cancelled', requestDate(record.cancelledAt)]] : []),
  ];
  return (
    <>
      <button className="approval-back" onClick={onClose}>
        <ArrowLeft size={15} /> Back to requests
      </button>
      <div className="approval-detail-top">
        <span className="approval-detail-icon">
          <FileText size={26} strokeWidth={1.4} />
        </span>
        <button aria-label="Close request details" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <h2>{requestTitle(record)}</h2>
      <div className="approval-status">
        <StatusBadge status={record.status || 'UNKNOWN'} />
      </div>
      <div className="approval-detail-body">
        {detail.loading && (
          <p role="status" className="approval-detail-note">
            Loading request details…
          </p>
        )}
        {detail.error && (
          <div role="alert" className="approval-detail-note">
            <p>{detail.error}</p>
            <button onClick={detail.reload}>Retry details</button>
          </div>
        )}
        {ready && (
          <>
            <dl className="approval-primary-fields">
              {primaryFields.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className={label === 'Amount' ? 'approval-detail-amount' : undefined}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {record.requestSummary && (
              <section className="approval-summary">
                <h3>Details</h3>
                <p>{record.requestSummary}</p>
              </section>
            )}
            <details className="approval-values">
              <summary>Routing and record details</summary>
              <dl>
                {fields.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </details>
            {record.notes && (
              <section className="approval-summary">
                <h3>Notes</h3>
                <p>{record.notes}</p>
              </section>
            )}
            {(record.oldValue != null || record.newValue != null) && (
              <details className="approval-values">
                <summary>Recorded changes</summary>
                {record.oldValue != null && (
                  <>
                    <h3>Before</h3>
                    <pre>{JSON.stringify(record.oldValue, null, 2)}</pre>
                  </>
                )}
                {record.newValue != null && (
                  <>
                    <h3>Proposed</h3>
                    <pre>{JSON.stringify(record.newValue, null, 2)}</pre>
                  </>
                )}
              </details>
            )}
            <section className="approval-history">
              <h3>Activity</h3>
              {record.actions?.length ? (
                record.actions.map((item) => (
                  <p key={item.id}>
                    <strong>{item.actionBy?.fullName || item.actionBy?.email || 'System'}</strong>
                    <span>
                      {item.action.toLowerCase().replaceAll('_', ' ')} ·{' '}
                      {requestDate(item.createdAt)}
                      {item.stepOrder != null ? ` · Step ${item.stepOrder}` : ''}
                    </span>
                    {item.comment && <span>{item.comment}</span>}
                    {item.reason && <span>{item.reason}</span>}
                  </p>
                ))
              ) : (
                <p>No activity recorded.</p>
              )}
            </section>
          </>
        )}
      </div>
      <div className="approval-actions">
        {own && record.status === 'PENDING' && <p>You can’t approve or reject your own request.</p>}
        {ready &&
          record.status === 'PENDING' &&
          !own &&
          !record.availableActions?.approve &&
          !record.availableActions?.reject && <p>No decision is available to you for this step.</p>}
        {record.status === 'PENDING' && hasPermission('approval_requests.approve') && (
          <Btn
            disabled={!decisionAllowed || !record.availableActions?.approve}
            onClick={() => setAction('approve')}
          >
            Approve request
          </Btn>
        )}
        {record.status === 'PENDING' && hasPermission('approval_requests.reject') && (
          <Btn
            variant="secondary"
            disabled={!decisionAllowed || !record.availableActions?.reject}
            onClick={() => setAction('reject')}
          >
            Reject request
          </Btn>
        )}
        {['DRAFT', 'PENDING'].includes(record.status || '') &&
          hasPermission('approval_requests.cancel') && (
            <Btn
              variant="ghost"
              disabled={
                !ready ||
                !['DRAFT', 'PENDING'].includes(record.status || '') ||
                !record.availableActions?.cancel
              }
              onClick={() => setAction('cancel')}
            >
              Cancel request
            </Btn>
          )}
      </div>
      {action && (
        <ApprovalRequestAction
          record={record}
          kind={action}
          onClose={() => setAction(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
