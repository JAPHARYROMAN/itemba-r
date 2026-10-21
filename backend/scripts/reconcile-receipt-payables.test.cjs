'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const {
  TARGETS,
  EXPECTED,
  hash,
  makeManifest,
  applyManifest,
  argumentsOf,
} = require('./reconcile-receipt-payables.cjs');

function fixture() {
  const orders = TARGETS.map(([id, number, total, paid]) => ({
    id,
    purchaseOrderNumber: number,
    companyId: '4074e49b-c278-424e-946f-6b897925d741',
    supplierId: `supplier-${number}`,
    supplierName: `Fixture ${number}`,
    currency: 'TZS',
    status: 'RECEIVED',
    purchaseType: 'STOCK_PURCHASE',
    totalAmount: total,
    paidAmount: paid,
    outstandingAmount: new Prisma.Decimal(total).minus(paid).toFixed(2),
    receivedAt: '2026-10-20T16:00:00.000Z',
    payableId: null,
    journalEntryId: null,
    deletedAt: null,
  }));
  const prepaid = orders.find((o) => o.paidAmount !== '0.00');
  const payment = {
    id: 'existing-payment',
    companyId: prepaid.companyId,
    supplierId: prepaid.supplierId,
    status: 'COMPLETED',
    deletedAt: null,
    currency: 'TZS',
    amount: EXPECTED.paid,
    appliedAmount: '0.00',
    unappliedAmount: EXPECTED.paid,
    paymentDate: '2026-10-06T00:00:00.000Z',
    allocations: [],
    journalEntryId: 'advance-journal',
  };
  return {
    orders,
    grns: [],
    invoices: [],
    payables: [],
    cashAccounts: [],
    cashMovements: [],
    applications: [],
    advances: [
      {
        id: 'advance',
        purchaseOrderId: prepaid.id,
        supplierPaymentId: payment.id,
        advanceAccountId: 'advance-asset',
        supplierPayment: payment,
      },
    ],
    journals: [
      {
        id: 'advance-journal',
        status: 'POSTED',
        deletedAt: null,
        reversedAt: null,
        referenceType: 'SupplierPayment',
        referenceId: payment.id,
        description: `Supplier advance ${prepaid.purchaseOrderNumber}`,
        lines: [
          { accountId: 'advance-asset', debit: EXPECTED.paid, credit: '0.00' },
          { accountId: 'cash', debit: '0.00', credit: EXPECTED.paid },
        ],
      },
    ],
  };
}

test('audited seven receipts preserve gross, actual debt and existing advance split', () => {
  const manifest = makeManifest(fixture(), Prisma);
  assert.deepEqual(manifest.totals, EXPECTED);
  assert.equal(manifest.rows.filter((r) => r.action === 'POST_RECEIPT_PAYABLE').length, 6);
  assert.equal(
    manifest.rows.filter((r) => r.action === 'POST_RECEIPT_AND_APPLY_EXISTING_ADVANCE').length,
    1,
  );
  assert.equal(hash(manifest), hash(makeManifest(fixture(), Prisma)));
});

test('existing source payable aborts instead of duplicating its liability', () => {
  const s = fixture();
  s.payables.push({ id: 'already-posted', sourceType: 'PurchaseOrder', sourceId: s.orders[0].id });
  assert.throws(() => makeManifest(s, Prisma), /liability coverage/);
});

test('an unlinked manual liability for the same supplier and amount blocks repair', () => {
  const s = fixture();
  s.payables.push({
    id: 'manual',
    sourceType: null,
    amount: s.orders[0].totalAmount,
    supplierId: s.orders[0].supplierId,
  });
  assert.throws(() => makeManifest(s, Prisma), /unlinked manual liability/);
});

test('existing source journal aborts even when the PO has no journal link', () => {
  const s = fixture();
  s.journals.push({
    id: 'unlinked',
    status: 'POSTED',
    deletedAt: null,
    referenceType: 'PurchaseOrder',
    referenceId: s.orders[0].id,
    description: 'Legacy receipt',
    lines: [],
  });
  assert.throws(() => makeManifest(s, Prisma), /unlinked posted accounting/);
});

test('prepaid receipt requires full unused advance with a posted asset journal', () => {
  const missing = fixture();
  missing.advances = [];
  assert.throws(() => makeManifest(missing, Prisma), /fully explained/);
  const used = fixture();
  used.advances[0].supplierPayment.appliedAmount = '1.00';
  assert.throws(() => makeManifest(used, Prisma), /already has allocations/);
  const journal = fixture();
  journal.journals[0].status = 'REVERSED';
  assert.throws(() => makeManifest(journal, Prisma), /journal is unavailable/);
  const future = fixture();
  future.advances[0].supplierPayment.paymentDate = '2026-10-21T00:00:00.000Z';
  assert.throws(() => makeManifest(future, Prisma), /later than receipt/);
});

test('changed source or amount does not inherit reviewed authorization', () => {
  const s = fixture();
  s.orders[0].totalAmount = '9068000.01';
  assert.throws(() => makeManifest(s, Prisma), /Financial values changed/);
  const scope = fixture();
  scope.orders[0].currency = 'USD';
  assert.throws(() => makeManifest(scope, Prisma), /lifecycle/);
});

test('apply rejects a wrong digest before entering a database transaction', async () => {
  let transactions = 0;
  await assert.rejects(
    applyManifest(
      {
        $transaction: () => {
          transactions++;
        },
      },
      makeManifest(fixture(), Prisma),
      'wrong',
      'operator',
      {},
      Prisma,
    ),
    /Expected digest/,
  );
  assert.equal(transactions, 0);
});

test('repeating the same applied manifest verifies saved liabilities and performs no mutation', async () => {
  const manifest = makeManifest(fixture(), Prisma),
    digest = hash(manifest);
  const result = {
    rows: manifest.rows.map((r, i) => ({
      purchaseOrderId: r.purchaseOrderId,
      payableId: `ap-${i}`,
    })),
  };
  let receiptCalls = 0;
  const tx = {
    $queryRaw: async () => [],
    auditLog: {
      findFirst: async () => ({
        metadata: { manifestDigestParts: digest.match(/.{16}/g) },
        newValue: result,
      }),
    },
    purchaseOrder: {
      findUniqueOrThrow: async ({ where }) => ({
        payableId: result.rows.find((r) => r.purchaseOrderId === where.id).payableId,
      }),
    },
    payable: {
      findUniqueOrThrow: async ({ where }) => {
        const source = manifest.rows[result.rows.findIndex((r) => r.payableId === where.id)];
        return {
          id: where.id,
          companyId: manifest.companyId,
          supplierId: source.supplierId,
          currency: 'TZS',
          deletedAt: null,
          status: 'OPEN',
          amount: source.totalAmount,
          paidAmount: source.paidAmount,
          outstandingAmount: source.outstandingAmount,
          journalEntry: { status: 'POSTED', deletedAt: null, reversedAt: null },
        };
      },
    },
  };
  const out = await applyManifest(
    { $transaction: async (callback) => callback(tx) },
    manifest,
    digest,
    'operator',
    {
      receipt: {
        ensureForPurchaseOrder: () => {
          receiptCalls++;
        },
      },
    },
    Prisma,
  );
  assert.equal(out.alreadyApplied, true);
  assert.equal(receiptCalls, 0);
});

test('CLI stays in read-only mode by default and rejects unknown flags', () => {
  assert.deepEqual(argumentsOf([]), { apply: false });
  assert.throws(() => argumentsOf(['--yes']), /Unknown argument/);
});
