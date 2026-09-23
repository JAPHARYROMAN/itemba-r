export type AdjustmentNumber = string | number | null;
type Named = { id?: string; name: string };
export interface StockAdjustment {
  id: string;
  adjustmentNumber?: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  company?: Named | null;
  division?: Named | null;
  branch?: Named | null;
  status: string;
  reason: string;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  approvedAt?: string | null;
  postedAt?: string | null;
  createdBy?: { fullName: string } | null;
  approvedBy?: { fullName: string } | null;
  postedBy?: { fullName: string } | null;
  _count?: { lines: number };
  lines?: AdjustmentLine[];
}
export interface AdjustmentLine {
  id: string;
  productId: string;
  product?: (Named & { sku?: string | null }) | null;
  unit?: (Named & { symbol?: string | null }) | null;
  systemQuantity?: AdjustmentNumber;
  countedQuantity?: AdjustmentNumber;
  varianceQuantity?: AdjustmentNumber;
  unitCost?: AdjustmentNumber;
  reason?: string | null;
}
export const adjustmentName = (row: StockAdjustment) => row.adjustmentNumber || row.id;
export const adjustmentScope = (row: StockAdjustment) => ({
  companyId: row.companyId,
  divisionId: row.divisionId || '',
  branchId: row.branchId || '',
});
export type AdjustmentAction = 'submit' | 'approve' | 'reject' | 'post' | 'revert' | 'delete';
export const adjustmentActions: Record<
  AdjustmentAction,
  { label: string; effect: string; permission: string; statuses: string[] }
> = {
  submit: {
    label: 'Submit for approval',
    effect: 'Send this draft for review. Stock stays unchanged until posting.',
    permission: 'inventory.adjustments.create',
    statuses: ['DRAFT'],
  },
  approve: {
    label: 'Approve adjustment',
    effect: 'Approve these recorded differences for posting. This step does not change stock.',
    permission: 'inventory.adjustments.approve',
    statuses: ['PENDING_APPROVAL'],
  },
  reject: {
    label: 'Reject adjustment',
    effect: 'Return a rejection with your reason. Stock stays unchanged.',
    permission: 'inventory.adjustments.approve',
    statuses: ['PENDING_APPROVAL'],
  },
  post: {
    label: 'Post adjustment',
    effect:
      'Apply these differences to inventory and create the accounting entries. Review every line before posting.',
    permission: 'inventory.adjustments.post',
    statuses: ['APPROVED'],
  },
  revert: {
    label: 'Revert to draft',
    effect: 'Remove the approval and return this unposted adjustment to Draft.',
    permission: 'inventory.adjustments.approve',
    statuses: ['APPROVED'],
  },
  delete: {
    label: 'Delete adjustment',
    effect:
      'Remove this draft or rejected adjustment from the register. No stock movement is created.',
    permission: 'inventory.adjustments.create',
    statuses: ['DRAFT', 'REJECTED'],
  },
};
