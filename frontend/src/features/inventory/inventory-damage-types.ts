import { productQuantity } from '@/components/workspace/product-form';
type Named = { id: string; name: string };
export interface StockDamage {
  id: string;
  damageNumber: string;
  companyId: string;
  branchId?: string | null;
  productId: string;
  batchId?: string | null;
  unitId: string;
  quantity?: string | number | null;
  damageType: string;
  estimatedValue?: string | number | null;
  status: string;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  approvedAt?: string | null;
  reportedById?: string | null;
  approvedById?: string | null;
  company?: Named | null;
  branch?: (Named & { divisionId?: string | null; division?: Named | null }) | null;
  product?:
    | (Named & { productCode?: string | null; sku?: string | null; barcode?: string | null })
    | null;
  unit?: (Named & { symbol?: string | null }) | null;
  batch?: { id: string; batchNumber: string } | null;
  reportedBy?: { id: string; fullName: string } | null;
  approvedBy?: { id: string; fullName: string } | null;
}
export const DAMAGE_TYPES = [
  'BREAKAGE',
  'EXPIRED',
  'SPOILED',
  'LOST',
  'THEFT',
  'DAMAGED_PACKAGING',
  'OTHER',
];
export const DAMAGE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'POSTED',
  'CANCELLED',
];
export const damageScope = (row: StockDamage) => ({
  companyId: row.companyId,
  divisionId: row.branch?.divisionId || '',
  branchId: row.branchId || '',
});
export function damageQuantity(row: StockDamage) {
  const value = productQuantity(row.quantity);
  return value === '—' ? value : `${value}${row.unit?.symbol ? ` ${row.unit.symbol}` : ''}`;
}
export function damageDate(value?: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? `${new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`
    : '—';
}
export type DamageAction = 'submit' | 'approve' | 'reject' | 'post';
export const DAMAGE_ACTIONS: Record<
  DamageAction,
  { label: string; permission: string; status: string; effect: string }
> = {
  submit: {
    label: 'Submit for review',
    permission: 'stock_damage.create',
    status: 'DRAFT',
    effect: 'Send this damage report for approval. Stock remains unchanged until posting.',
  },
  approve: {
    label: 'Approve report',
    permission: 'stock_damage.approve',
    status: 'SUBMITTED',
    effect: 'Approve this damage report for posting. Approval alone does not reduce stock.',
  },
  reject: {
    label: 'Reject report',
    permission: 'stock_damage.approve',
    status: 'SUBMITTED',
    effect: 'Mark this report as rejected. No stock movement will be created.',
  },
  post: {
    label: 'Post write-off',
    permission: 'stock_damage.post',
    status: 'APPROVED',
    effect:
      'Reduce inventory by the recorded quantity and reduce the linked batch, if present. Accounting uses the actual inventory value relieved; the estimate below is not the posting amount.',
  },
};
