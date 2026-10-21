#!/usr/bin/env node
'use strict';

/**
 * Audited repair for the seven receipts behind the 20 October 2026 card.
 * Default: a READ ONLY transaction produces a reviewable manifest and SHA256.
 * Apply: --apply --manifest FILE --expected-digest SHA --user-id UUID
 * Run beside a built backend (../dist), or inject that module tree when proving
 * a candidate against production dependencies. No Nest app/jobs are started.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const REPAIR_ID = 'receipt-payables-20261020';
const COMPANY_ID = '4074e49b-c278-424e-946f-6b897925d741';
const TARGETS = [
  ['2bb6c8ab-1d09-4b0d-b790-4ddef2716a1d', 'PO-2026-000050', '9068000.00', '0.00'],
  ['81c6052b-9df9-4aa2-b82f-f1aff897efcd', 'PO-2026-000051', '4459000.00', '0.00'],
  ['d7d3452c-6cfd-46e3-91c2-ba3cd8ba8fbf', 'PO-2026-000052', '28780000.00', '0.00'],
  ['17afd3fa-86ad-4ca1-852d-34f554156552', 'PO-2026-000053', '30800000.00', '0.00'],
  ['81b598e6-434b-4a80-9ab5-ae63c126948a', 'PO-2026-000054', '114525000.00', '0.00'],
  ['48c5efbf-2449-4004-9668-c72925b27c8c', 'PO-2026-000058', '45400000.00', '45400000.00'],
  ['1fa8d19b-779d-43ea-8281-31c02922533b', 'PO-2026-000062', '49150000.10', '0.00'],
];
const EXPECTED = { gross: '282182000.10', paid: '45400000.00', outstanding: '236782000.10' };
const TARGET_IDS = TARGETS.map(([id]) => id);
const json = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byId = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const need = (condition, message) => {
  if (!condition) throw new Error(message);
};

function dependencies(prisma, ReceiptPayablesOverride) {
  const { AccountResolverService } = require('../dist/common/services/account-resolver.service');
  const {
    AccountingControlService,
  } = require('../dist/common/services/accounting-control.service');
  const { AuditLogsService } = require('../dist/modules/audit-logs/audit-logs.service');
  const {
    PostingEngineService,
  } = require('../dist/modules/accounting-engine/posting-engine.service');
  const {
    EntityCodeGeneratorService,
  } = require('../dist/modules/entity-code-generator/entity-code-generator.service');
  const ReceiptPayablesService =
    ReceiptPayablesOverride ??
    require('../dist/modules/receipt-payables/receipt-payables.service').ReceiptPayablesService;
  const {
    SupplierPurchaseAdvancesService,
  } = require('../dist/modules/supplier-payments/supplier-purchase-advances.service');
  const {
    SupplierPaymentsService,
  } = require('../dist/modules/supplier-payments/supplier-payments.service');
  const { CompanyScopeService } = require('../dist/common/services/company-scope.service');
  const {
    OrganizationScopeService,
  } = require('../dist/common/services/organization-scope.service');
  const accounts = new AccountResolverService(prisma);
  const controls = new AccountingControlService(prisma);
  const posting = new PostingEngineService(prisma, controls, accounts);
  const audit = new AuditLogsService(prisma);
  const codes = new EntityCodeGeneratorService(prisma);
  const payments = new SupplierPaymentsService(
    prisma,
    audit,
    new CompanyScopeService(prisma),
    accounts,
    posting,
    codes,
  );
  const advances = new SupplierPurchaseAdvancesService(
    posting,
    accounts,
    codes,
    payments,
    new OrganizationScopeService(prisma),
    audit,
  );
  return {
    accounts,
    controls,
    posting,
    audit,
    receipt: new ReceiptPayablesService(codes, accounts, posting, audit),
    advances,
  };
}

async function readSnapshot(tx) {
  const orders = byId(
    await tx.purchaseOrder.findMany({
      where: { id: { in: TARGET_IDS }, companyId: COMPANY_ID },
      include: { lines: { orderBy: { id: 'asc' } } },
    }),
  );
  const grns = byId(
    await tx.goodsReceivedNote.findMany({
      where: { companyId: COMPANY_ID, purchaseOrderId: { in: TARGET_IDS } },
      include: { lines: { orderBy: { id: 'asc' } } },
    }),
  );
  const invoices = byId(await tx.supplierInvoice.findMany({ where: { companyId: COMPANY_ID } }));
  const payables = byId(await tx.payable.findMany({ where: { companyId: COMPANY_ID } }));
  const journals = byId(
    await tx.journalEntry.findMany({
      where: { companyId: COMPANY_ID },
      include: { lines: { orderBy: { id: 'asc' } } },
    }),
  );
  const advances = byId(
    await tx.supplierPurchaseAdvance.findMany({
      where: { purchaseOrderId: { in: TARGET_IDS } },
      include: {
        supplierPayment: { include: { allocations: { orderBy: { id: 'asc' } } } },
      },
    }),
  );
  const applications = byId(
    await tx.supplierPurchaseAdvanceApplication.findMany({
      where: { advanceId: { in: advances.map((a) => a.id) } },
    }),
  );
  const cashAccounts = byId(
    await tx.cashAccount.findMany({
      where: { companyId: COMPANY_ID },
      select: { id: true, currentBalance: true },
    }),
  );
  const cashMovements = byId(
    await tx.cashDeskMovement.findMany({
      where: { entries: { some: { account: { companyId: COMPANY_ID } } } },
      select: {
        id: true,
        amount: true,
        currency: true,
        reversedAt: true,
        reversalOfId: true,
        journalEntryId: true,
        supplierPaymentId: true,
      },
    }),
  );
  return json({
    orders,
    grns,
    invoices,
    payables,
    journals,
    advances,
    applications,
    cashAccounts,
    cashMovements,
  });
}

function makeManifest(snapshot, Prisma) {
  const D = (v = 0) => new Prisma.Decimal(v);
  need(
    snapshot.orders.length === TARGETS.length,
    'A target purchase order is missing or changed company.',
  );
  const rows = TARGETS.map(([id, number, amount, paid]) => {
    const o = snapshot.orders.find((r) => r.id === id);
    need(
      !o.deletedAt &&
        o.status === 'RECEIVED' &&
        o.currency === 'TZS' &&
        o.purchaseType === 'STOCK_PURCHASE',
      `Review the lifecycle of ${number}.`,
    );
    need(
      o.purchaseOrderNumber === number &&
        D(o.totalAmount).eq(amount) &&
        D(o.paidAmount).eq(paid) &&
        D(o.outstandingAmount).eq(D(amount).minus(paid)),
      `Financial values changed for ${number}.`,
    );
    need(
      !o.payableId && !o.journalEntryId,
      `${number} already has linked accounting; review before applying this manifest.`,
    );
    const grns = snapshot.grns.filter((g) => g.purchaseOrderId === id);
    need(
      grns.every(
        (g) =>
          !g.deletedAt &&
          g.status === 'POSTED' &&
          g.companyId === COMPANY_ID &&
          g.supplierId === o.supplierId,
      ),
      `Review GRNs for ${number}.`,
    );
    const invoiceRows = snapshot.invoices.filter(
      (i) => i.purchaseOrderId === id || grns.some((g) => g.id === i.goodsReceivedNoteId),
    );
    const invoiceIds = new Set(invoiceRows.map((i) => i.id));
    const sourceIds = new Set([id, ...grns.map((g) => g.id)]);
    const covered = snapshot.payables.filter(
      (p) =>
        (p.sourceType === 'PurchaseOrder' && p.sourceId === id) ||
        (p.sourceType === 'GoodsReceivedNote' && sourceIds.has(p.sourceId)) ||
        (p.sourceType === 'SupplierInvoice' && invoiceIds.has(p.sourceId)) ||
        invoiceRows.some((i) => i.payableId === p.id),
    );
    need(covered.length === 0, `${number} already has source or invoice liability coverage.`);
    const ambiguous = snapshot.payables.filter(
      (p) =>
        !p.deletedAt &&
        p.status !== 'CANCELLED' &&
        p.supplierId === o.supplierId &&
        ((!p.sourceType && D(p.amount).eq(amount)) || (p.notes || '').includes(number)),
    );
    need(
      ambiguous.length === 0,
      `${number} may be covered by an unlinked manual liability; review it first.`,
    );
    need(invoiceRows.length === 0, `${number} has invoice history; review its accounting first.`);
    const accounting = snapshot.journals.filter(
      (j) =>
        j.status === 'POSTED' &&
        !j.deletedAt &&
        ((sourceIds.has(j.referenceId) &&
          ['PurchaseOrder', 'GoodsReceivedNote'].includes(j.referenceType)) ||
          (j.description.includes(number) && j.referenceType !== 'SupplierPayment')),
    );
    need(accounting.length === 0, `${number} has unlinked posted accounting.`);
    const advances = snapshot.advances.filter((a) => a.purchaseOrderId === id);
    const advanceTotal = advances.reduce(
      (sum, a) => sum.plus(a.supplierPayment.unappliedAmount),
      D(),
    );
    need(
      advanceTotal.eq(paid),
      `${number} recorded settlement is not fully explained by existing unapplied advances.`,
    );
    for (const a of advances) {
      const payment = a.supplierPayment;
      need(
        payment.status === 'COMPLETED' &&
          !payment.deletedAt &&
          payment.companyId === COMPANY_ID &&
          payment.supplierId === o.supplierId &&
          payment.currency === o.currency,
        `Advance scope or status differs for ${number}.`,
      );
      need(
        D(payment.appliedAmount).isZero() &&
          D(payment.amount).eq(payment.unappliedAmount) &&
          payment.allocations.length === 0,
        `Advance already has allocations for ${number}.`,
      );
      need(
        snapshot.applications.every((app) => app.advanceId !== a.id),
        `Advance already has applications for ${number}.`,
      );
      const journal = snapshot.journals.find((j) => j.id === payment.journalEntryId);
      need(
        journal &&
          journal.status === 'POSTED' &&
          !journal.deletedAt &&
          !journal.reversedAt &&
          journal.referenceType === 'SupplierPayment' &&
          journal.referenceId === payment.id,
        `Advance journal is unavailable for ${number}.`,
      );
      const assetDebit = journal.lines
        .filter((l) => l.accountId === a.advanceAccountId)
        .reduce((s, l) => s.plus(l.debit).minus(l.credit), D());
      need(
        assetDebit.eq(payment.unappliedAmount),
        `Advance asset does not equal the available payment for ${number}.`,
      );
      need(
        new Date(o.receivedAt) >= new Date(payment.paymentDate),
        `Advance is later than receipt ${number}.`,
      );
    }
    return {
      purchaseOrderId: id,
      purchaseOrderNumber: number,
      companyId: COMPANY_ID,
      supplierId: o.supplierId,
      supplierName: o.supplierName,
      currency: o.currency,
      totalAmount: D(amount).toFixed(2),
      paidAmount: D(paid).toFixed(2),
      outstandingAmount: D(amount).minus(paid).toFixed(2),
      transactionDate: o.receivedAt,
      grnIds: grns.map((g) => g.id).sort(),
      advanceIds: advances.map((a) => a.id).sort(),
      action: advances.length ? 'POST_RECEIPT_AND_APPLY_EXISTING_ADVANCE' : 'POST_RECEIPT_PAYABLE',
    };
  });
  const totals = {
    gross: rows.reduce((s, r) => s.plus(r.totalAmount), D()).toFixed(2),
    paid: rows.reduce((s, r) => s.plus(r.paidAmount), D()).toFixed(2),
    outstanding: rows.reduce((s, r) => s.plus(r.outstandingAmount), D()).toFixed(2),
  };
  assert.deepEqual(
    totals,
    EXPECTED,
    'The reviewed screenshot amount or its settlement split changed.',
  );
  return {
    repairId: REPAIR_ID,
    companyId: COMPANY_ID,
    currency: 'TZS',
    totals,
    inputDigest: hash(snapshot),
    rows,
  };
}

async function operator(tx, id) {
  const row = await tx.user.findFirst({
    where: { id, status: 'ACTIVE', deletedAt: null },
    include: {
      userRoles: {
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      },
      companyAccess: true,
      branchAccess: true,
    },
  });
  need(
    row && row.userRoles.some((r) => r.role.scope === 'GROUP'),
    'Choose an active group-scoped operator with authority over this repair.',
  );
  return {
    id: row.id,
    email: row.email,
    companyId: row.companyId,
    companyAccess: row.companyAccess,
    branchAccess: row.branchAccess,
    roles: row.userRoles.map((r) => r.role.name),
    roleScopes: row.userRoles.map((r) => r.role.scope),
    permissions: [
      ...new Set(
        row.userRoles.flatMap((r) => r.role.rolePermissions.map((x) => x.permission.code)),
      ),
    ],
  };
}

async function verifyResult(tx, manifest, result, Prisma) {
  const D = (v = 0) => new Prisma.Decimal(v);
  for (const row of manifest.rows) {
    const saved = result.rows.find((r) => r.purchaseOrderId === row.purchaseOrderId);
    need(saved, 'Stored reconciliation result is incomplete.');
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: row.purchaseOrderId } });
    const payable = await tx.payable.findUniqueOrThrow({
      where: { id: saved.payableId },
      include: { journalEntry: true },
    });
    need(
      order.payableId === payable.id &&
        payable.companyId === COMPANY_ID &&
        payable.supplierId === row.supplierId &&
        payable.currency === 'TZS' &&
        !payable.deletedAt &&
        !['CANCELLED', 'WRITTEN_OFF'].includes(payable.status) &&
        D(payable.amount).eq(row.totalAmount),
      'Reconciled payable changed or lost its source link.',
    );
    need(
      payable.journalEntry?.status === 'POSTED' &&
        !payable.journalEntry.deletedAt &&
        !payable.journalEntry.reversedAt,
      'Reconciled payable journal is no longer posted.',
    );
    need(
      D(payable.paidAmount).plus(payable.outstandingAmount).eq(payable.amount),
      'Reconciled payable settlement no longer balances.',
    );
  }
}

async function applyManifest(prisma, manifest, expectedDigest, userId, services, Prisma) {
  const digest = hash(manifest);
  need(digest === expectedDigest, 'Expected digest does not match the reviewed manifest.');
  need(
    manifest.repairId === REPAIR_ID && manifest.companyId === COMPANY_ID,
    'Manifest belongs to a different repair.',
  );
  assert.deepEqual(manifest.totals, EXPECTED);
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${REPAIR_ID}, 0))`;
      const prior = await tx.auditLog.findFirst({
        where: { action: 'RECEIPT_PAYABLE_RECONCILE', entityId: REPAIR_ID, companyId: COMPANY_ID },
        orderBy: { createdAt: 'desc' },
      });
      if (prior) {
        need(
          prior.metadata?.manifestDigestParts?.join('') === digest,
          'This repair was previously applied with a different manifest.',
        );
        await verifyResult(tx, manifest, prior.newValue, Prisma);
        return { ...prior.newValue, alreadyApplied: true, manifestDigest: digest };
      }
      const user = await operator(tx, userId);
      // Lock every source in the same deterministic order used across retries.
      for (const id of [...TARGET_IDS].sort())
        await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
      const before = await readSnapshot(tx);
      const current = makeManifest(before, Prisma);
      need(
        hash(current) === digest,
        'Financial evidence changed after review; create a new read-only manifest.',
      );
      const rows = [];
      for (const row of manifest.rows) {
        const posted = await services.receipt.ensureForPurchaseOrder({
          purchaseOrderId: row.purchaseOrderId,
          companyId: COMPANY_ID,
          transactionDate: new Date(row.transactionDate),
          userId,
          tx,
          reconcileHistoricalSettlement: row.advanceIds.length > 0,
        });
        need(
          posted?.payableId && posted.postedAmount === row.totalAmount,
          `Receipt did not post exactly once for ${row.purchaseOrderNumber}.`,
        );
        if (row.advanceIds.length)
          await services.advances.apply(
            tx,
            user,
            row.purchaseOrderId,
            posted.payableId,
            new Date(row.transactionDate),
          );
        const payable = await tx.payable.findUniqueOrThrow({ where: { id: posted.payableId } });
        need(
          payable.paidAmount.toFixed(2) === row.paidAmount &&
            payable.outstandingAmount.toFixed(2) === row.outstandingAmount,
          `Settlement differs for ${row.purchaseOrderNumber}.`,
        );
        rows.push({
          purchaseOrderId: row.purchaseOrderId,
          purchaseOrderNumber: row.purchaseOrderNumber,
          payableId: payable.id,
          journalEntryId: posted.journalEntryId,
          amount: payable.amount.toFixed(2),
          paidAmount: payable.paidAmount.toFixed(2),
          outstandingAmount: payable.outstandingAmount.toFixed(2),
        });
      }
      const after = await readSnapshot(tx);
      assert.deepEqual(
        after.cashAccounts,
        before.cashAccounts,
        'The repair must not change cash balances.',
      );
      assert.deepEqual(
        after.cashMovements,
        before.cashMovements,
        'The repair must not create or change cash movements.',
      );
      assert.deepEqual(
        after.payables.filter((p) => before.payables.some((old) => old.id === p.id)),
        before.payables,
        'An existing liability was changed.',
      );
      assert.deepEqual(
        after.journals.filter((j) => before.journals.some((old) => old.id === j.id)),
        before.journals,
        'An existing journal was changed.',
      );
      need(
        after.payables.length - before.payables.length === 7,
        'Expected exactly seven source payables.',
      );
      const D = (v = 0) => new Prisma.Decimal(v);
      const newJournals = after.journals.filter(
        (j) => !before.journals.some((old) => old.id === j.id),
      );
      need(
        newJournals.length === 8 && newJournals.every((j) => j.status === 'POSTED' && !j.deletedAt),
        'Expected seven receipt journals and one advance application.',
      );
      const accounts = await services.accounts.resolveMany(
        COMPANY_ID,
        ['AP_CONTROL', 'INVENTORY_ASSET'],
        tx,
      );
      const netCredit = (accountId) =>
        newJournals
          .flatMap((j) => j.lines)
          .filter((l) => l.accountId === accountId)
          .reduce((s, l) => s.plus(l.credit).minus(l.debit), D());
      need(
        netCredit(accounts.AP_CONTROL.id).eq(EXPECTED.outstanding),
        'New AP accounting differs from actual additional debt.',
      );
      need(
        netCredit(accounts.INVENTORY_ASSET.id).eq(D(EXPECTED.gross).negated()),
        'New inventory accounting differs from the received value.',
      );
      need(
        before.advances.length === 1 &&
          netCredit(before.advances[0].advanceAccountId).eq(EXPECTED.paid),
        'Existing advance was not cleared exactly once.',
      );
      need(
        after.applications.length - before.applications.length === 1,
        'Expected one canonical advance application.',
      );
      const result = {
        repairId: REPAIR_ID,
        companyId: COMPANY_ID,
        totals: manifest.totals,
        rows,
        newPayables: 7,
        additionalOutstanding: EXPECTED.outstanding,
        existingAdvanceApplied: EXPECTED.paid,
        cashUnchanged: true,
        existingLiabilitiesUnchanged: true,
        alreadyApplied: false,
      };
      await verifyResult(tx, manifest, result, Prisma);
      await services.audit.logStrictInTransaction(tx, {
        action: 'RECEIPT_PAYABLE_RECONCILE',
        entityType: 'ReceiptPayableReconciliation',
        entityId: REPAIR_ID,
        companyId: COMPANY_ID,
        userId,
        channel: 'SYSTEM',
        oldValue: { unpostedReceivedAmount: EXPECTED.gross },
        // The audit prose scrubber removes opaque 64-character strings even in
        // digest fields. Store this nonsecret provenance checksum as 16-character
        // chunks so retries can verify the reviewed manifest after serialization.
        newValue: result,
        metadata: {
          manifestDigestParts: digest.match(/.{16}/g),
          reason: 'User-authorized credit receipt and existing advance reconciliation',
          inputDigestParts: manifest.inputDigest.match(/.{16}/g),
        },
      });
      return { ...result, manifestDigest: digest };
    },
    { isolationLevel: 'Serializable', timeout: 120000, maxWait: 10000 },
  );
}

function argumentsOf(argv) {
  const options = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--manifest') options.manifest = argv[++i];
    else if (arg === '--expected-digest') options.expectedDigest = argv[++i];
    else if (arg === '--user-id') options.userId = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = argumentsOf(argv);
  const { PrismaClient, Prisma } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (options.apply) {
      need(
        options.manifest && options.expectedDigest && options.userId,
        '--apply requires --manifest, --expected-digest and --user-id.',
      );
      const manifest = JSON.parse(fs.readFileSync(path.resolve(options.manifest), 'utf8'));
      const result = await applyManifest(
        prisma,
        manifest,
        options.expectedDigest,
        options.userId,
        dependencies(prisma),
        Prisma,
      );
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const manifest = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return makeManifest(await readSnapshot(tx), Prisma);
      },
      { isolationLevel: 'RepeatableRead', timeout: 120000 },
    );
    if (options.out)
      fs.writeFileSync(path.resolve(options.out), JSON.stringify(manifest, null, 2) + '\n');
    const result = { readOnly: true, submittedWrites: 0, manifestDigest: hash(manifest), manifest };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  TARGETS,
  EXPECTED,
  hash,
  readSnapshot,
  makeManifest,
  applyManifest,
  argumentsOf,
  main,
  dependencies,
};
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
