import { openPartyIn } from '@/features/party/party-links';

export type RequestAction = 'approve' | 'reject' | 'cancel';
export interface ApprovalRequest {
  id: string;
  approvalRequestNumber?: string;
  requestTitle?: string;
  requestSummary?: string | null;
  entityType?: string;
  entityId?: string;
  // Party linkage (Phase 3): the supplier or customer behind the request.
  partyType?: string | null;
  supplierId?: string | null;
  customerId?: string | null;
  supplier?: { id: string; name: string; supplierCode?: string | null } | null;
  customer?: { id: string; name: string; customerCode?: string | null } | null;
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
/** Party linkage (Phase 3): the party behind the request and where it opens, or null. */
export const requestParty = (
  row: ApprovalRequest,
): { kind: 'supplier' | 'customer'; id: string; name: string; href: string } | null => {
  const supplierId = row.supplier?.id || (row.partyType === 'SUPPLIER' ? row.supplierId : null);
  if (supplierId)
    return {
      kind: 'supplier',
      id: supplierId,
      name: row.supplier?.name || 'Supplier',
      href: openPartyIn('profile', 'supplier', supplierId),
    };
  const customerId = row.customer?.id || (row.partyType === 'CUSTOMER' ? row.customerId : null);
  if (customerId)
    return {
      kind: 'customer',
      id: customerId,
      name: row.customer?.name || 'Customer',
      href: openPartyIn('profile', 'customer', customerId),
    };
  return null;
};
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
