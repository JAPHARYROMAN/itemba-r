import type { Draft, DraftContext, Submission } from './types';
export const contextFixture: DraftContext = {
  scope: { companyId: 'company', divisionId: 'division', branchId: 'branch' },
  capabilities: {
    canSubmitSale: true,
    canSubmitStock: true,
    canApprove: true,
    canPrepare: true,
    canDirectPost: true,
  },
  products: [
    {
      id: 'product',
      name: 'Cement',
      code: 'CEM',
      barcode: '123456',
      unitId: 'unit',
      unitSymbol: 'bag',
      sellingPrice: 100,
      quantityOnHand: 20,
      physicalRevision: 'rev1',
      trackInventory: true,
    },
  ],
  customers: [{ id: 'customer', name: 'Customer A' }],
  unpaidSales: [],
  purchaseOrders: [
    {
      id: 'purchase',
      purchaseOrderNumber: 'PO-001',
      supplierId: 'supplier',
      supplierName: 'Supplier A',
      status: 'CONFIRMED',
      lines: [{ productId: 'product', name: 'Cement', quantity: 10, unitCost: 75, lineTotal: 750 }],
      totalAmount: 750,
      purchaseType: 'CREDIT',
      paymentTerms: 'Pay in 30 days',
      currency: 'TZS',
    },
  ],
  branches: [
    { id: 'branch', name: 'Branch A' },
    { id: 'other', name: 'Branch B' },
  ],
  accounts: [],
  paymentMethods: ['CASH', 'MOBILE_MONEY'],
  creditEnabled: false,
};
export const submissionFixture: Submission = {
  ...contextFixture.scope,
  requestId: 'original-request',
  kind: 'SALE',
  businessDate: '2026-10-04',
  capturedAt: '2026-10-04T10:00:00.000Z',
  payload: {
    customerId: 'customer',
    paymentMethod: 'CASH',
    expectedTotal: 100,
    lines: [{ productId: 'product', quantity: 1, unitPrice: 100 }],
  },
};
export const draftFixture: Draft = {
  ...submissionFixture,
  id: 'draft',
  revision: 1,
  status: 'SUBMITTED',
  originRole: 'CASHIER',
  originUserId: 'operator',
  amount: 100,
  pendingMoney: 100,
  currency: 'TZS',
  createdAt: '2026-10-04T10:00:00.000Z',
  allowedActions: ['approve', 'reject'],
};
