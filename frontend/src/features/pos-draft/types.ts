export type PosRole = 'CASHIER' | 'STOCKIST' | 'ADMIN';
export type DraftKind = 'SALE' | 'COLLECTION' | 'RECEIPT' | 'TRANSFER' | 'COUNT' | 'DAMAGE';
export type DraftAction =
  | 'correct'
  | 'approve'
  | 'prepare'
  | 'reject'
  | 'direct-post'
  | 'confirm-return';
export type DraftStatus =
  | 'SUBMITTED'
  | 'AWAITING_STOCKIST'
  | 'READY_FINAL'
  | 'POSTED'
  | 'REJECTED'
  | 'NEEDS_ATTENTION';
export type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'CREDIT' | 'MIXED';
export type Scope = {
  companyId: string;
  divisionId?: string;
  branchId: string;
  terminalId?: string;
};
export type Capabilities = {
  canSubmitSale: boolean;
  canSubmitStock: boolean;
  canApprove: boolean;
  canPrepare: boolean;
  canDirectPost: boolean;
};
export type Product = {
  id: string;
  name: string;
  code?: string;
  barcode?: string | null;
  unitId: string;
  unitSymbol: string;
  sellingPrice: number | null;
  quantityOnHand: number;
  quantityAvailable?: number;
  physicalRevision: string | number;
  trackInventory: boolean;
};
export type Customer = {
  id: string;
  name: string;
  customerCode?: string | null;
  phone?: string | null;
};
export type DraftContext = {
  scope: Scope;
  capabilities: Capabilities;
  products: Product[];
  customers: Customer[];
  unpaidSales: Array<{
    id: string;
    salesOrderNumber: string;
    customerId: string;
    customerName: string;
    outstandingAmount: number | string;
  }>;
  purchaseOrders: Array<{
    id: string;
    purchaseOrderNumber: string;
    supplierId: string;
    supplierName: string;
    status: string;
    lines: Array<{
      productId: string;
      name: string;
      quantity: number | string;
      unitCost: number | string;
      lineTotal: number | string;
    }>;
    totalAmount: number | string;
    purchaseType: string;
    paymentTerms?: string | null;
    currency?: string;
  }>;
  branches: Array<{ id: string; name: string; divisionId?: string }>;
  accounts: Array<{ id: string; accountName: string; accountType: string; currency: string }>;
  paymentMethods: Array<'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER'>;
  creditEnabled: boolean;
};
export type DraftLine = {
  productId: string;
  quantity?: number;
  unitPrice?: number;
  /** Captured list price supplied by the server for administrator review. */
  listUnitPrice?: number;
  priceReason?: string;
  priceNote?: string;
  countedQuantity?: number;
  baselineQuantity?: number;
  physicalRevision?: string | number;
};
export type DraftPayload = {
  customerId?: string;
  paymentMethod?: PaymentMethod;
  method?: Exclude<PaymentMethod, 'CREDIT' | 'MIXED'>;
  cashAccountId?: string;
  paymentReference?: string;
  reference?: string;
  expectedTotal?: number;
  lines?: DraftLine[];
  payments?: Array<{ method: Exclude<PaymentMethod, 'MIXED'>; amount: number; reference?: string }>;
  salesOrderId?: string;
  amount?: number;
  purchaseOrderId?: string;
  fullOrderArrived?: boolean;
  destinationBranchId?: string;
  productId?: string;
  quantity?: number;
  damageType?: string;
  reason?: string;
  batchId?: string;
};
export type Submission = Omit<Scope, 'terminalId'> & {
  requestId: string;
  kind: DraftKind;
  businessDate: string;
  capturedAt: string;
  payload: DraftPayload;
};
export function submissionEnvelope(body: Submission): Submission {
  return {
    requestId: body.requestId,
    companyId: body.companyId,
    divisionId: body.divisionId,
    branchId: body.branchId,
    businessDate: body.businessDate,
    capturedAt: body.capturedAt,
    kind: body.kind,
    payload: body.payload,
  };
}
export type LocalAcknowledgement = Submission & { local: true; state: 'LOCAL' };
export type Draft = Submission & {
  id: string;
  revision: number;
  status: DraftStatus;
  originRole: PosRole;
  originUserId: string;
  continuedExisting?: boolean;
  captureDraftId?: string;
  originUser?: { fullName?: string; name?: string };
  company?: { name: string };
  branch?: { name: string };
  amount: number | string | null;
  pendingMoney: number | string | null;
  currency: string;
  blockingReason?: string | null;
  reservedUntil?: string | null;
  postedEntityType?: string | null;
  postedEntityId?: string | null;
  postedAt?: string | null;
  createdAt: string;
  allowedActions?: DraftAction[];
  decisions?: Array<{
    id: string;
    action: string;
    reason?: string | null;
    createdAt: string;
    actor?: { fullName?: string };
    actorId?: string;
  }>;
  reservations?: Array<{ productId: string; quantity: number | string; expiresAt?: string }>;
  duplicateCandidates?: Array<{
    id: string;
    requestId: string;
    originUserId: string;
    businessDate: string;
    status: string;
    amount: number | string;
  }>;
};
export type DraftPage = {
  data: Draft[];
  total: number;
  page: number;
  limit: number;
  capabilities: Capabilities;
  summary: {
    pendingMoney: number | string;
    awaitingApproval: number;
    awaitingStockist: number;
    readyFinal: number;
  };
};
export type DraftOutcome = {
  state: 'not_found' | 'pending' | 'posted' | 'rejected' | 'needs_attention';
  draft?: Draft;
  postedEntityType?: string;
  postedEntityId?: string;
};
export type PostedReceipt = {
  receiptNumber: string;
  companyName: string;
  branchName: string;
  businessDate: string;
  customerName: string;
  paymentMethod: string;
  subtotal: number | string;
  taxAmount: number | string;
  totalAmount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  payments: Array<{ method: string; amount: number | string; reference?: string }>;
  lines: Array<{
    productId: string;
    name: string;
    quantity: number | string;
    unitPrice: number | string;
    lineTotal: number | string;
  }>;
  originUserId: string;
  approvedByUserId: string;
};
export const KIND_LABELS: Record<DraftKind, string> = {
  SALE: 'Sale',
  COLLECTION: 'Collection',
  RECEIPT: 'Stock receipt',
  TRANSFER: 'Stock transfer',
  COUNT: 'Stock count',
  DAMAGE: 'Stock damage',
};
export const STATUS_LABELS: Record<DraftStatus, string> = {
  SUBMITTED: 'Awaiting approval',
  AWAITING_STOCKIST: 'Awaiting stockist',
  READY_FINAL: 'Ready for final approval',
  POSTED: 'Posted',
  REJECTED: 'Rejected',
  NEEDS_ATTENTION: 'Needs attention',
};
export const money = (value: number | string | null | undefined, currency = 'TZS') =>
  `${currency} ${Number(value ?? 0).toLocaleString('en', { maximumFractionDigits: 2 })}`;
export const businessDate = (capturedAt: Date | string = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dar_es_Salaam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(capturedAt));
export function postedHref(draft: Draft): string | null {
  if (!draft.postedEntityId) return null;
  const id = encodeURIComponent(draft.postedEntityId);
  if (draft.postedEntityType === 'SalesOrder') return `/sales-desk/sales/${id}`;
  if (draft.postedEntityType === 'StockAdjustment')
    return `/operations/stock-adjustments?record=${id}`;
  if (draft.postedEntityType === 'StockDamage') return `/westsides/stock-damage?record=${id}`;
  if (draft.postedEntityType === 'GoodsReceivedNote') return `/procurement/grns?record=${id}`;
  if (draft.postedEntityType === 'PurchaseOrder') return `/operations/purchase-orders/${id}`;
  if (draft.postedEntityType === 'PosDraftTransfer')
    return `/pos-draft/stock/${encodeURIComponent(draft.id)}`;
  if (draft.postedEntityType === 'CustomerPayment') return `/sales-desk?record=${id}`;
  if (draft.postedEntityType === 'StockTransfer') return `/operations/stock-transfers?record=${id}`;
  return null;
}
