import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'backend/package.json'));
const { PrismaClient, Prisma } = require('@prisma/client');
const local = readFileSync(resolve(root, 'backend/.env'), 'utf8');
const configured =
  process.env.OPENING_AUDIT_DATABASE_URL ||
  local.match(/^DATABASE_URL\s*=\s*["']?([^\r\n"']+)/m)?.[1];
if (!configured) throw new Error('Set OPENING_AUDIT_DATABASE_URL or configure backend/.env.');
const target = new URL(configured);
const db = new PrismaClient({ datasources: { db: { url: configured } } });
const D = (value = 0) => new Prisma.Decimal(value ?? 0);
const normal = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en')
    .replace(/\s+/g, ' ');
const models = [
  'Company',
  'CompanyProfile',
  'Division',
  'Branch',
  'Supplier',
  'InvoiceDeskSupplier',
  'Customer',
  'SalesDeskCustomer',
  'Employee',
  'Product',
  'InventoryBalance',
  'InvoiceDeskInvoice',
  'InvoiceDeskPayment',
  'SupplierInvoice',
  'Payable',
  'Receivable',
  'SalesDeskSale',
  'SalesDeskPayment',
  'Loan',
  'LoanRepayment',
  'LoanFinancialEvent',
  'CashAccount',
  'CashDeskAccount',
  'CashDeskEntry',
  'CashDeskMovement',
  'ChartOfAccount',
  'JournalEntry',
  'JournalEntryLine',
  'PayrollRun',
];
// Only read audit-relevant scalar fields. Never collect passwords, attachments or bank details.
const allowed = new Set([
  'id',
  'companyId',
  'divisionId',
  'branchId',
  'supplierId',
  'customerId',
  'employeeId',
  'productId',
  'accountId',
  'journalEntryId',
  'movementId',
  'invoiceId',
  'saleId',
  'loanId',
  'erpCashAccountId',
  'ledgerAccountId',
  'name',
  'nameKey',
  'fullName',
  'code',
  'employeeCode',
  'accountName',
  'accountCode',
  'accountType',
  'invoiceNumber',
  'supplierInvoiceNumber',
  'numberKey',
  'referenceType',
  'referenceId',
  'status',
  'employmentStatus',
  'isActive',
  'deletedAt',
  'voidedAt',
  'reversedAt',
  'currency',
  'totalAmount',
  'paidAmount',
  'outstandingAmount',
  'outstandingBalance',
  'principalAmount',
  'amountPaid',
  'amount',
  'balance',
  'openingBalance',
  'currentBalance',
  'debit',
  'credit',
  'totalDebit',
  'totalCredit',
  'quantityOnHand',
  'averageCost',
  'totalValue',
  'invoiceReference',
  'baseSalary',
  'hireDate',
  'paymentMethod',
  'journalEntryId',
  'paymentJournalEntryId',
]);
const findings = [];
function finding(code, severity, ids, explanation) {
  if (ids.length)
    findings.push({ code, severity, count: ids.length, recordIds: ids.slice(0, 100), explanation });
}
function duplicateCandidates(left, right, fields, code) {
  const lookup = new Map();
  for (const row of left) {
    const key = fields.map((field) => normal(row[field])).join('|');
    if (!fields.every((f) => row[f])) continue;
    lookup.set(key, [...(lookup.get(key) || []), row.id]);
  }
  const ids = right.flatMap((row) => {
    if (!fields.every((f) => row[f])) return [];
    const key = fields.map((field) => normal(row[field])).join('|');
    return (lookup.get(key) || []).filter((id) => id !== row.id).map((id) => `${id}/${row.id}`);
  });
  finding(
    code,
    'review',
    [...new Set(ids)],
    'Matching company and normalized identity is a duplicate candidate, not authority to merge. Confirm source ownership before import.',
  );
}
try {
  const result = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const [{ transaction_read_only: transactionReadOnly }] = await tx.$queryRawUnsafe(
        'SHOW transaction_read_only',
      );
      if (transactionReadOnly !== 'on')
        throw new Error('Opening audit requires a read-only database transaction.');
      const rows = {};
      for (const name of models) {
        const metadata = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
        if (!metadata)
          throw new Error(`Missing model ${name}; audit cannot silently omit a register.`);
        const select = Object.fromEntries(
          metadata.fields
            .filter((f) => f.kind !== 'object' && allowed.has(f.name))
            .map((f) => [f.name, true]),
        );
        rows[name] = await tx[name[0].toLowerCase() + name.slice(1)].findMany({ select });
      }
      const active = (name) => rows[name].filter((r) => !r.deletedAt && !r.voidedAt);
      const divisions = new Map(active('Division').map((d) => [d.id, d]));
      const branches = new Map(active('Branch').map((b) => [b.id, b]));
      const profiles = new Map(rows.CompanyProfile.map((p) => [p.companyId, p]));
      finding(
        'company-currency-profile',
        'blocking',
        active('Company')
          .filter((c) => !profiles.get(c.id)?.currency)
          .map((c) => c.id),
        'Company accounting currency/profile is required before opening journals.',
      );
      for (const name of [
        'Employee',
        'Product',
        'InvoiceDeskInvoice',
        'SalesDeskSale',
        'CashDeskAccount',
        'CashAccount',
        'Supplier',
        'Customer',
        'InventoryBalance',
      ]) {
        finding(
          `${name}-organisation`,
          'blocking',
          active(name)
            .filter(
              (r) =>
                (r.divisionId && divisions.get(r.divisionId)?.companyId !== r.companyId) ||
                (r.branchId &&
                  (!branches.has(r.branchId) ||
                    divisions.get(branches.get(r.branchId)?.divisionId)?.companyId !==
                      r.companyId ||
                    (r.divisionId && branches.get(r.branchId).divisionId !== r.divisionId))),
            )
            .map((r) => r.id),
          'Record points outside its active company/division/branch hierarchy.',
        );
      }
      duplicateCandidates(
        active('Supplier'),
        active('InvoiceDeskSupplier'),
        ['companyId', 'name'],
        'supplier-cross-app-candidates',
      );
      duplicateCandidates(
        active('Customer'),
        active('SalesDeskCustomer'),
        ['companyId', 'name'],
        'customer-cross-app-candidates',
      );
      duplicateCandidates(
        active('Employee'),
        active('Employee'),
        ['companyId', 'fullName'],
        'employee-identity-candidates',
      );
      const supplierNames = new Map(
        [...active('Supplier'), ...active('InvoiceDeskSupplier')].map((s) => [s.id, s.name]),
      );
      duplicateCandidates(
        active('SupplierInvoice').map((i) => ({
          ...i,
          supplierName: supplierNames.get(i.supplierId),
          externalNumber: i.invoiceReference || i.supplierInvoiceNumber,
        })),
        active('InvoiceDeskInvoice').map((i) => ({
          ...i,
          supplierName: supplierNames.get(i.supplierId),
          externalNumber: i.invoiceNumber,
        })),
        ['companyId', 'supplierName', 'externalNumber', 'currency'],
        'purchase-cross-app-document-candidates',
      );
      for (const register of ['SupplierInvoice', 'Receivable', 'Payable'])
        finding(
          `${register}-outstanding-control`,
          'blocking',
          active(register)
            .filter((row) => {
              const total = D(row.totalAmount ?? row.amount),
                paid = D(row.paidAmount);
              return paid.lt(0) || paid.gt(total) || !total.minus(paid).eq(row.outstandingAmount);
            })
            .map((row) => row.id),
          'Stored outstanding balance differs from the document amount less payments.',
        );
      finding(
        'employee-opening-readiness',
        'review',
        active('Employee')
          .filter(
            (e) => e.employmentStatus !== 'TERMINATED' && (!e.hireDate || !D(e.baseSalary).gt(0)),
          )
          .map((e) => e.id),
        'Review employee commencement and salary basis against HR-approved records; no payroll values were inferred.',
      );
      const currencies = new Map();
      for (const [document, payment, parent] of [
        ['InvoiceDeskInvoice', 'InvoiceDeskPayment', 'invoiceId'],
        ['SalesDeskSale', 'SalesDeskPayment', 'saleId'],
      ]) {
        const inconsistent = [];
        for (const row of active(document)) {
          const paid = rows[payment]
            .filter((p) => p[parent] === row.id && !p.reversedAt)
            .reduce((sum, p) => sum.plus(p.amount), D());
          if (!paid.eq(row.paidAmount) || paid.gt(row.totalAmount) || paid.lt(0))
            inconsistent.push(row.id);
          const key = `${document}:${row.companyId}:${row.currency}`;
          const total = currencies.get(key) || {
            register: document,
            companyId: row.companyId,
            currency: row.currency,
            documents: 0,
            amount: D(),
            paid: D(),
            outstanding: D(),
          };
          total.documents++;
          total.amount = total.amount.plus(row.totalAmount);
          total.paid = total.paid.plus(paid);
          total.outstanding = total.outstanding.plus(D(row.totalAmount).minus(paid));
          currencies.set(key, total);
        }
        finding(
          `${document}-payment-total`,
          'blocking',
          inconsistent,
          'Stored paid amount differs from unreversed payments, or payments exceed the document amount.',
        );
      }
      const journals = active('JournalEntry').filter((j) =>
        ['POSTED', 'REVERSED'].includes(j.status),
      );
      const postedIds = new Set(journals.map((j) => j.id));
      const lines = rows.JournalEntryLine.filter((l) => postedIds.has(l.journalEntryId));
      const chart = new Map(active('ChartOfAccount').map((a) => [a.id, a]));
      finding(
        'journal-company-account',
        'blocking',
        lines
          .filter(
            (l) =>
              chart.get(l.accountId)?.companyId !== l.companyId ||
              journals.find((j) => j.id === l.journalEntryId)?.companyId !== l.companyId,
          )
          .map((l) => l.id),
        'A posted journal line has a deleted/missing account or crosses company boundaries.',
      );
      finding(
        'journal-balance',
        'blocking',
        journals
          .filter((j) => {
            const entries = lines.filter((l) => l.journalEntryId === j.id);
            const debit = entries.reduce((n, l) => n.plus(l.debit), D()),
              credit = entries.reduce((n, l) => n.plus(l.credit), D());
            return !debit.eq(credit) || !debit.eq(j.totalDebit) || !credit.eq(j.totalCredit);
          })
          .map((j) => j.id),
        'Posted journal lines do not balance or disagree with header totals.',
      );
      const balance = (accountId) =>
        lines
          .filter((l) => l.accountId === accountId)
          .reduce((n, l) => n.plus(l.debit).minus(l.credit), D());
      finding(
        'cash-ledger-unmapped',
        'blocking',
        active('CashAccount')
          .filter((a) => !a.ledgerAccountId && !D(a.currentBalance).eq(0))
          .map((a) => a.id),
        'Nonzero bank/cash balance has no mapped ledger control account.',
      );
      finding(
        'cash-ledger-difference',
        'blocking',
        active('CashAccount')
          .filter((a) => a.ledgerAccountId && !balance(a.ledgerAccountId).eq(a.currentBalance))
          .map((a) => a.id),
        'Recorded cash balance does not agree with posted journal lines.',
      );
      finding(
        'desk-cash-entry-difference',
        'blocking',
        active('CashDeskAccount')
          .filter(
            (a) =>
              !rows.CashDeskEntry.filter((e) => e.accountId === a.id)
                .reduce((n, e) => n.plus(e.amount), D())
                .eq(a.balance),
          )
          .map((a) => a.id),
        'Cash Desk balance does not equal its signed entries.',
      );
      finding(
        'desk-cash-unmapped',
        'blocking',
        active('CashDeskAccount')
          .filter((a) => !a.erpCashAccountId && !D(a.balance).eq(0))
          .map((a) => a.id),
        'Cash Desk opening/cash balance still requires an ERP cash and ledger connection.',
      );
      finding(
        'stock-negative',
        'blocking',
        active('InventoryBalance')
          .filter((r) => D(r.quantityOnHand).lt(0))
          .map((r) => r.id),
        'Negative opening quantity needs count and movement reconciliation.',
      );
      finding(
        'stock-valuation-control',
        'review',
        active('InventoryBalance')
          .filter((r) =>
            D(r.quantityOnHand).times(D(r.averageCost)).minus(D(r.totalValue)).abs().gt('0.01'),
          )
          .map((r) => r.id),
        'Stored stock valuation differs from quantity multiplied by average cost; reconcile with the approved stock count.',
      );
      finding(
        'loan-balance-review',
        'review',
        active('Loan')
          .filter(
            (l) => D(l.outstandingBalance).lt(0) || D(l.outstandingBalance).gt(l.principalAmount),
          )
          .map((l) => l.id),
        'Loan balance is negative or exceeds original principal; reconcile it with lender statements and approved capitalisation.',
      );
      finding(
        'paid-payroll-unposted',
        'blocking',
        active('PayrollRun')
          .filter(
            (r) =>
              r.status === 'PAID' &&
              (!postedIds.has(r.journalEntryId) || !postedIds.has(r.paymentJournalEntryId)),
          )
          .map((r) => r.id),
        'A paid payroll run is missing a posted accrual or payment journal.',
      );
      return {
        generatedAt: new Date().toISOString(),
        basis: 'current snapshot; opening date and external control totals not yet agreed',
        target: { host: target.hostname, database: target.pathname.slice(1) },
        readOnlyTransaction: true,
        counts: Object.fromEntries(models.map((name) => [name, active(name).length])),
        findings,
        deskControlTotals: [...currencies.values()].map((r) => ({
          ...r,
          amount: r.amount.toFixed(2),
          paid: r.paid.toFixed(2),
          outstanding: r.outstanding.toFixed(2),
        })),
        approvedForOpening: false,
        requiredExternalEvidence: [
          'Opening date and source-system freeze',
          'Signed trial balance by company and currency',
          'Bank/cash counts and statements',
          'Supplier/customer unpaid document lists',
          'HR employee and payroll balances',
          'Stock count and valuation',
          'Lender statements and intercompany confirmations',
          'Duplicate review and source-of-truth mapping',
        ],
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 120000 },
  );
  mkdirSync(resolve(root, '.release'), { recursive: true });
  writeFileSync(resolve(root, '.release/opening-data-audit.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        counts: result.counts,
        findings: result.findings.map(({ code, severity, count }) => ({ code, severity, count })),
        approvedForOpening: false,
      },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
