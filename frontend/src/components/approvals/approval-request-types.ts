export type RequestAction = 'approve' | 'reject' | 'cancel';
export interface ApprovalRequest {
  id: string;
  approvalRequestNumber?: string;
  requestTitle?: string;
  requestSummary?: string | null;
  entityType?: string;
  entityId?: string;
  actionType?: string;
  status?: string;
  companyId?: string | null;
  company?: { id: string; name: string } | null;
  amount?: number | string | null;
  currency?: string | null;
  requestedById?: string;
  requestedBy?: { id?: string; fullName?: string; email?: string };
  createdAt?: string;
  submittedAt?: string | null;
  dueAt?: string | null;
  updatedAt?: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  cancelledAt?: string | null;
  workflow?: {
    name?: string;
    steps?: { id: string; stepName: string; stepOrder: number }[];
  } | null;
  currentStepOrder?: number;
  riskLevel?: string | null;
  notes?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  availableActions?: Record<RequestAction, boolean>;
  actions?: {
    id: string;
    action: string;
    comment?: string | null;
    reason?: string | null;
    createdAt: string;
    stepOrder?: number;
    actionBy?: { fullName?: string; email?: string };
  }[];
}
export const requestPath = '/approvals/requests';
export const requestStatuses = [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'ESCALATED',
  'EXPIRED',
];
export const requestTitle = (row: ApprovalRequest) =>
  row.requestTitle || row.entityType?.replaceAll('_', ' ') || 'Approval request';
export const requestPerson = (row: ApprovalRequest) =>
  row.requestedBy?.fullName || row.requestedBy?.email || row.requestedById || '—';
export function requestAmount(row: ApprovalRequest) {
  if (row.amount == null || row.amount === '') return '—';
  const value = Number(row.amount);
  return Number.isFinite(value)
    ? `${row.currency || ''} ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim()
    : '—';
}
export function requestDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
