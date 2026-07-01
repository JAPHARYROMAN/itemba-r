'use client';
import { useState, useEffect, useCallback } from 'react';
import { PageSpinner, showToast } from '@/components/ui';
import { ResponsiveDataTable, AuroraButton, Modal, FormTextarea } from '@/components/aurora';
import type { ResponsiveColumn } from '@/components/aurora';
import { backendPage, backendPatch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

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

function requesterIdOf(row: ApprovalRequestRow): string | undefined {
  return row.requestedById ?? row.requestedBy?.id ?? row.requester?.id ?? row.requesterId;
}

function actionTypeOf(row: ApprovalRequestRow): string | undefined {
  return row.actionType ?? row.triggerAction;
}

function daysPending(createdAt?: string): number | null {
  if (!createdAt) return null;
  const ms = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function formatAmount(amount: ApprovalRequestRow['amount'], currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = Number(amount);
  return `${currency || ''} ${Number.isFinite(num) ? num.toLocaleString() : '0'}`.trim();
}

export default function PendingApprovalsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ApprovalRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-row action busy flags keep other rows interactive while one is processing.
  const [busyId, setBusyId] = useState<string | null>(null);

  // Reject flow state (ConfirmDialog + optional reason field).
  const [rejectTarget, setRejectTarget] = useState<ApprovalRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await backendPage<ApprovalRequestRow>('/approvals/requests/pending/me');
      setItems(page.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pending approvals');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const removeRow = useCallback((id: string) => {
    setItems(prev => prev.filter(r => r.id !== id));
  }, []);

  async function handleApprove(row: ApprovalRequestRow) {
    setBusyId(row.id);
    try {
      await backendPatch(`/approvals/requests/${row.id}/approve`, {});
      const reqNo = requestNumberOf(row);
      showToast('success', 'Request approved', reqNo ? `${reqNo} has been approved.` : undefined);
      removeRow(row.id);
    } catch (e) {
      // Maker-checker (400) and other backend failures surface their message.
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Failed to approve request';
      showToast('error', 'Approval failed', msg);
    } finally {
      setBusyId(null);
    }
  }

  function openReject(row: ApprovalRequestRow) {
    setRejectTarget(row);
    setRejectReason('');
  }

  function closeReject() {
    if (busyId) return; // don't close mid-request
    setRejectTarget(null);
    setRejectReason('');
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    const row = rejectTarget;
    setBusyId(row.id);
    try {
      const reason = rejectReason.trim();
      await backendPatch(`/approvals/requests/${row.id}/reject`, reason ? { reason } : {});
      const reqNo = requestNumberOf(row);
      showToast('success', 'Request rejected', reqNo ? `${reqNo} has been rejected.` : undefined);
      removeRow(row.id);
      setRejectTarget(null);
      setRejectReason('');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Failed to reject request';
      showToast('error', 'Rejection failed', msg);
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
      key: 'actionType',
      header: 'Action',
      priority: 3,
      accessor: row => actionTypeOf(row) || '—',
    },
    {
      key: 'requester',
      header: 'Requester',
      priority: 2,
      accessor: row => {
        const r = requesterOf(row);
        return r?.fullName || r?.email || '—';
      },
    },
    {
      key: 'amount',
      header: 'Amount',
      priority: 1,
      align: 'right',
      accessor: row => formatAmount(row.amount, row.currency),
    },
    {
      key: 'daysPending',
      header: 'Days Pending',
      priority: 3,
      accessor: row => {
        const d = daysPending(row.createdAt);
        if (d === null) return '—';
        return (
          <span
            className="font-medium"
            style={{ color: d > 3 ? 'var(--aurora-danger)' : 'var(--aurora-text-secondary)' }}
          >
            {d}d
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      priority: 1,
      exportExclude: true,
      accessor: row => {
        // Maker-checker: a submitter cannot approve/reject their own request.
        const requesterId = requesterIdOf(row);
        const isOwn = !!user?.id && !!requesterId && user.id === requesterId;
        const rowBusy = busyId === row.id;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <AuroraButton
              size="sm"
              variant="primary"
              loading={rowBusy}
              disabled={isOwn || (!!busyId && !rowBusy)}
              title={isOwn ? 'You cannot approve your own request' : undefined}
              onClick={() => handleApprove(row)}
            >
              Approve
            </AuroraButton>
            <AuroraButton
              size="sm"
              variant="danger"
              disabled={isOwn || !!busyId}
              title={isOwn ? 'You cannot reject your own request' : undefined}
              onClick={() => openReject(row)}
            >
              Reject
            </AuroraButton>
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>Pending Approvals</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Approval requests awaiting your action</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <ResponsiveDataTable<ApprovalRequestRow>
          columns={columns}
          data={items}
          keyField="id"
          error={error}
          onRetry={load}
          errorTitle="Couldn't load pending approvals"
          emptyTitle="No pending approvals"
          emptyDescription="You're all caught up — nothing is awaiting your action."
        />
      )}

      {/* Reject confirmation with an optional reason. */}
      <Modal
        open={!!rejectTarget}
        onClose={closeReject}
        title="Reject request"
        description={
          rejectTarget && requestNumberOf(rejectTarget)
            ? `You're about to reject ${requestNumberOf(rejectTarget)}. This can't be undone.`
            : "You're about to reject this request. This can't be undone."
        }
        size="sm"
      >
        <div className="px-5 pb-5 pt-4 space-y-4">
          <FormTextarea
            label="Reason"
            help="Optional — shared with the requester."
            placeholder="Why is this being rejected?"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            disabled={!!busyId}
          />
          <div className="flex items-center justify-end gap-3">
            <AuroraButton variant="secondary" size="md" disabled={!!busyId} onClick={closeReject}>
              Cancel
            </AuroraButton>
            <AuroraButton variant="danger" size="md" loading={!!busyId} onClick={confirmReject}>
              Reject request
            </AuroraButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
