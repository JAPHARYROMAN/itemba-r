/* Synthetic statement documents for visual QA. No database or network writes. */
const path = require('node:path');
const fs = require('node:fs');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
require('ts-node/register/transpile-only');
const { Prisma } = require('@prisma/client');
const {
  customerStatementPdf,
} = require('../src/modules/customer-statements/customer-statement-pdf');
const { buildBusinessPdf } = require('../src/modules/generated-documents/pdf-builder');
const D = (value = 0) => new Prisma.Decimal(value);
const output = path.resolve(__dirname, '../../tmp/pdfs');
fs.mkdirSync(output, { recursive: true });

function fixture(name, opening, entries, credit = '0.00') {
  let running = D(opening),
    debits = D(),
    credits = D();
  const lines = entries.map((entry, index) => {
    const debit = D(entry.debit),
      payment = D(entry.credit);
    running = running.plus(debit).minus(payment);
    debits = debits.plus(debit);
    credits = credits.plus(payment);
    return {
      date: new Date(Date.UTC(2026, 1, 1 + (index % 28))),
      type: debit.gt(0) ? 'INVOICE' : 'PAYMENT',
      reference: entry.reference ?? `TEST-REF-${String(index + 1).padStart(4, '0')}`,
      description:
        entry.description ??
        'Customer receipt allocated to the invoice shown in the payment record',
      sourceId: `fixture-${index}`,
      debit,
      credit: payment,
      balance: running,
    };
  });
  const invoiceBalance = Prisma.Decimal.max(0, running.plus(credit));
  const statement = {
    companyId: 'fixture-company',
    customerId: 'fixture-customer',
    customerName: 'Example Wholesale Customer Limited',
    customerEmail: 'accounts@example.invalid',
    currency: 'TZS',
    company: {
      id: 'fixture-company',
      name: 'Example Trading Company Limited',
      code: 'EXAMPLE',
      address: 'Synthetic fixture address, Dar es Salaam',
      phone: '+255 000 000 000',
      email: 'finance@example.invalid',
    },
    customer: {
      id: 'fixture-customer',
      customerCode: 'CUST-TEST-001',
      address: 'Synthetic customer address, Arusha',
      email: 'accounts@example.invalid',
      phone: '+255 000 000 001',
    },
    scope: { companyId: 'fixture-company', unrestricted: true, divisionIds: [], branchIds: [] },
    runId: `fixture-${name}`,
    statementRunNumber: `TEST-STATEMENT-${name.toUpperCase()}`,
    dateFrom: new Date('2026-02-01T00:00:00Z'),
    dateTo: new Date('2026-02-28T23:59:59Z'),
    generatedAt: new Date('2026-03-01T09:00:00Z'),
    openingBalance: D(opening),
    totalDebits: debits,
    totalCredits: credits,
    closingBalance: running,
    lines,
    lineCount: lines.length,
    openInvoiceBalance: invoiceBalance,
    customerCredit: D(credit),
    netBalance: running,
    aging: {
      current: invoiceBalance.toNumber(),
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      over90: 0,
      total: invoiceBalance.toNumber(),
      oldestDaysOverdue: 0,
    },
    agingAsOf: new Date('2026-02-28T23:59:59Z'),
    warnings: [],
  };
  const filename = path.join(output, `customer-statement-${name}-fixture.pdf`);
  fs.writeFileSync(filename, buildBusinessPdf(customerStatementPdf(statement)));
  console.log(filename);
}
fixture('multipage', '1250000.25', [
  {
    debit: '987654321.01',
    credit: '0',
    description:
      'Wholesale invoice with a deliberately long product and delivery description to verify line wrapping, table spacing and financial alignment',
    reference: 'TEST-INVOICE-WITH-LONG-REFERENCE-00001',
  },
  ...Array.from({ length: 72 }, (_, index) => ({
    debit: '0',
    credit: '1432100.05',
    reference: `TEST-BANK-TRANSFER-${String(index + 1).padStart(4, '0')}`,
    description:
      index % 5
        ? 'Payment received by bank transfer and allocated against the wholesale invoice'
        : 'Partial payment with extended narrative: regional delivery reconciliation and customer remittance reference retained for the statement history',
  })),
]);
fixture('no-activity', '12345678.90', []);
fixture(
  'customer-credit',
  '0',
  [
    { debit: '100', credit: '0', description: 'Invoice raised', reference: 'TEST-INV-001' },
    {
      debit: '0',
      credit: '150',
      description: 'Payment including customer advance',
      reference: 'TEST-PAY-001',
    },
  ],
  '50',
);
