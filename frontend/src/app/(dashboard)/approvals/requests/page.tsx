'use client';
import { useState, useEffect, useCallback } from 'react';
import { PageSpinner, showToast } from '@/components/ui';
import { ResponsiveDataTable, StatusBadge, AuroraButton, Modal, FormTextarea } from '@/components/aurora';
import type { ResponsiveColumn } from '@/components/aurora';
import { getApprovalStatusVariant } from '@/lib/design-system/status';
import { backendPage, backendPatch, ApiError } from '@/lib/api-client';

interface Requester {
  id?: string;
  fullName?: string;
  email?: string;
}

interface ApprovalRequestRow extends Record<string, unknown> {
  id: string;
  // Backend returns approvalRequestNumber / requestedBy / requestedById / actionType.
  // Legacy aliases (requestNumber / requester / requesterId / triggerAction) kept as fallbacks.
  approvalRequestNumber?: string;
  requestNumber?: string;
  entityType?: string;
  actionType?: string;
  triggerAction?: string;
  status?: string;
  requestedBy?: Requester;
  requester?: Requester;
  requestedById?: string;
  requesterId?: string;
  amount?: number | string | null;
  currency?: string | null;
  createdAt?: string;
}

function requestNumberOf(row: ApprovalRequestRow): string | undefined {
  return row.approvalRequestNumber ?? row.requestNumber;
}

function requesterOf(row: ApprovalRequestRow): Requester | undefined {
  return row.requestedBy ?? row.requester;
}

type ActionKind = 'reject' | 'cancel';

const ACTION_COPY: Record<ActionKind, {
  title: string;
  verb: string;
  pastTense: string;
  reasonHelp: string;
  confirmLabel: string;
  variant: 'danger' | 'default';
}> = {
  reject: {
    title: 'Reject request',
    verb: 'reject',
    pastTense: 'rejected',
    reasonHelp: 'Optional — shared with the requester.',
    confirmLabel: 'Reject request',
    variant: 'danger',
  },
  cancel: {
    title: 'Cancel request',
    verb: 'cancel',
    pastTense: 'cancelled',
    reasonHelp: 'Optional — recorded on the request.',
    confirmLabel: 'Cancel request',
    variant: 'danger',
  },
};

function formatAmount(amount: ApprovalRequestRow['amount'], currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = Number(amount);
  return `${currency || ''} ${Number.isFinite(num) ? num.toLocaleString() : '0'}`.trim();
}

export default function ApprovalRequestsPage() {
  const [requests, setRequests] = useState<ApprovalRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEntityType, setFilterEntityType] = useState('');

  const [busyId, setBusyId] = useState<string | null>(null);

  // Reason-capturing dialog (used for reject + cancel).
  const [dialog, setDialog] = useState<{ kind: ActionKind; row: ApprovalRequestRow } | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await backendPage<ApprovalRequestRow>('/approvals/requests', {
        query: {
          status: filterStatus || undefined,
          entityType: filterEntityType || undefined,
        },
      });
      setRequests(page.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load approval requests');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterEntityType]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = useCallback((id: string, status: string) => {
    setRequests(prev => prev.map(r => (r.id === id ? { ...r, status } : r)));
  }, []);

  async function handleApprove(row: ApprovalRequestRow) {
    setBusyId(row.id);
    try {
      await backendPatch(`/approvals/requests/${row.id}/approve`, {});
      const reqNo = requestNumberOf(row);
      showToast('success', 'Request approved', reqNo ? `${reqNo} has been approved.` : undefined);
      updateStatus(row.id, 'APPROVED');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Failed to approve request';
      showToast('error', 'Approval failed', msg);
    } finally {
      setBusyId(null);
    }
  }

  function openDialog(kind: ActionKind, row: ApprovalRequestRow) {
    setDialog({ kind, row });
    setReason('');
  }

  function closeDialog() {
    if (busyId) return;
    setDialog(null);
    setReason('');
  }

  async function confirmDialog() {
    if (!dialog) return;
    const { kind, row } = dialog;
    const copy = ACTION_COPY[kind];
    setBusyId(row.id);
    try {
      const trimmed = reason.trim();
      // reject → { reason }, cancel → { reason }; both DTO-optional.
      await backendPatch(`/approvals/requests/${row.id}/${kind}`, trimmed ? { reason: trimmed } : {});
      const reqNo = requestNumberOf(row);
      showToast('success', `Request ${copy.pastTense}`, reqNo ? `${reqNo} has been ${copy.pastTense}.` : undefined);
      updateStatus(row.id, kind === 'reject' ? 'REJECTED' : 'CANCELLED');
      setDialog(null);
      setReason('');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : `Failed to ${copy.verb} request`;
      showToast('error', `${copy.title.split(' ')[0]} failed`, msg);
    } finally {
      setBusyId(null);
    }
  }

  const columns: ResponsiveColumn<ApprovalRequestRow>[] = [
    {
      key: 'requestNumber',
      header: 'Request #',
      priority: 1,
      accessor: row => (
        <span className="font-mono" style={{ color: 'var(--aurora-text)' }}>{requestNumberOf(row) || '—'}</span>
      ),
    },
    {
      key: 'entityType',
      header: 'Entity Type',
      priority: 2,
      accessor: row => row.entityType || '—',
    },
    {
      key: 'triggerAction',
      header: 'Action',
      priority: 3,
      accessor: row => row.actionType ?? row.triggerAction ?? '—',
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      accessor: row => <StatusBadge status={row.status} variant={getApprovalStatusVariant(row.status)} size="sm" />,
    },
    {
      key: 'requester',
      header: 'Requester',
      priority: 2,
      accessor: row => {
        const requester = requesterOf(row);
        return requester?.fullName || requester?.email || '—';
      },
    },
    {
      key: 'amount',
      header: 'Amount',
      priority: 2,
      align: 'right',
      accessor: row => formatAmount(row.amount, row.currency),
    },
    {
      key: 'createdAt',
      header: 'Created',
      priority: 3,
      accessor: row => (row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—'),
    },
    {
      key: 'actions',
      header: 'Actions',
      priority: 1,
      exportExclude: true,
      accessor: row => {
        if (row.status !== 'PENDING') {
          return <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>—</span>;
        }
        const rowBusy = busyId === row.id;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <AuroraButton
              size="sm"
              variant="primary"
              loading={rowBusy}
              disabled={!!busyId && !rowBusy}
              onClick={() => handleApprove(row)}
            >
              Approve
            </AuroraButton>
            <AuroraButton
              size="sm"
              variant="danger"
              disabled={!!busyId}
              onClick={() => openDialog('reject', row)}
            >
              Reject
            </AuroraButton>
            <AuroraButton
              size="sm"
              variant="ghost"
              disabled={!!busyId}
              onClick={() => openDialog('cancel', row)}
            >
              Cancel
            </AuroraButton>
          </div>
        );
      },
    },
  ];

  const activeCopy = dialog ? ACTION_COPY[dialog.kind] : null;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>Approval Requests</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>All approval requests across the group</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="aurora-input text-sm w-full sm:w-auto"
          style={{ height: '38px' }}
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="ESCALATED">Escalated</option>
        </select>
        <input
          type="text"
          placeholder="Filter by entity type..."
          value={filterEntityType}
          onChange={e => setFilterEntityType(e.target.value)}
          className="aurora-input text-sm w-full sm:w-52"
          style={{ height: '38px' }}
        />
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <ResponsiveDataTable<ApprovalRequestRow>
          columns={columns}
          data={requests}
          keyField="id"
          error={error}
          onRetry={load}
          errorTitle="Couldn't load approval requests"
          emptyTitle="No requests found"
          emptyDescription="No approval requests match the current filters."
        />
      )}

      {/* Reject / Cancel confirmation with an optional reason. */}
      <Modal
        open={!!dialog}
        onClose={closeDialog}
        title={activeCopy?.title ?? 'Confirm'}
        description={
          dialog
            ? `You're about to ${activeCopy!.verb} ${requestNumberOf(dialog.row) ?? 'this request'}. This can't be undone.`
            : undefined
        }
        size="sm"
      >
        <div className="px-5 pb-5 pt-4 space-y-4">
          <FormTextarea
            label="Reason"
            help={activeCopy?.reasonHelp}
            placeholder={`Why is this being ${activeCopy?.pastTense ?? 'actioned'}?`}
            value={reason}
            onChange={e => setReason(e.target.value)}
            disabled={!!busyId}
          />
          <div className="flex items-center justify-end gap-3">
            <AuroraButton variant="secondary" size="md" disabled={!!busyId} onClick={closeDialog}>
              Cancel
            </AuroraButton>
            <AuroraButton variant="danger" size="md" loading={!!busyId} onClick={confirmDialog}>
              {activeCopy?.confirmLabel ?? 'Confirm'}
            </AuroraButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
