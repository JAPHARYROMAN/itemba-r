// Synthetic PDF fixtures only; no database, network or business writes.
const path = require('node:path');
const fs = require('node:fs');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
require('ts-node/register/transpile-only');
const { Prisma } = require('@prisma/client');
const { recordsPdf, recordDetailPdf } = require('../src/modules/records/records.pdf');
const { bookPdf } = require('../src/modules/record-book/record-book.pdf');
const { buildBusinessPdf } = require('../src/modules/generated-documents/pdf-builder');
const output = path.resolve(__dirname, '../../tmp/pdfs/records-exports');
fs.mkdirSync(output, { recursive: true });
const org = {
  name: 'ITEMBA GROUP',
  address: 'Synthetic visual review - not business data',
  logoText: 'IG',
};
const base = {
  id: 'sample-record',
  title: 'Materials supplied - September',
  counterparty: 'Example Supplies',
  contact: 'accounts@example.invalid',
  category: 'Materials',
  currency: 'TZS',
  amount: new Prisma.Decimal('1250000.30'),
  settledAmount: new Prisma.Decimal('250000.10'),
  recordDate: new Date('2026-09-01'),
  dueDate: new Date('2026-10-01'),
  voidedAt: null,
  reference: 'TEST-001',
  companyId: null,
  company: { name: 'Example company' },
  division: { name: 'Retail' },
  branch: { name: 'Example branch' },
};
const notebook = ['DEBTOR', 'CREDITOR', 'SALE', 'PURCHASE', 'EXPENSE', 'NOTE'].flatMap(
  (kind, index) =>
    Array.from({ length: kind === 'NOTE' ? 1 : 9 }, (_, n) => ({
      ...base,
      id: `${index}-${n}`,
      kind,
      currency: n === 8 ? 'USD' : 'TZS',
      amount: kind === 'NOTE' ? new Prisma.Decimal(0) : base.amount,
      notes:
        kind === 'NOTE'
          ? 'A useful line of text retained in full.\n'.repeat(90) + 'END OF LONG NOTE'
          : null,
    })),
);
const sales = Array.from({ length: 36 }, (_, n) => ({
  id: `sale-${n}`,
  company: base.company,
  division: base.division,
  branch: base.branch,
  recordDate: '2026-09-01',
  currency: 'TZS',
  totalSalesAmount: 1234567.89,
  status: 'FINALIZED',
  receipts: [
    { receiptType: 'CASH', amount: 234567.89, reference: 'CASH-001' },
    { receiptType: 'BANK', label: 'Bank receipts', amount: 1000000, reference: 'BANK-001' },
  ],
}));
const expenses = [
  {
    id: 'expense',
    company: base.company,
    recordDate: '2026-09-01',
    currency: 'TZS',
    amount: 98765.43,
    status: 'DRAFT',
    description: 'Office supplies',
    paidTo: 'Example supplier',
    paymentMethod: 'CASH',
    reference: 'EXP-001',
  },
];
const categories = [
  {
    id: 'category',
    name: 'Office supplies',
    description: 'Paper, stationery and office consumables.',
    company: base.company,
    isActive: true,
  },
];
const models = {
  notebook: recordsPdf(notebook, { page: 1, from: '2026-09-01', to: '2026-09-30' }),
  note: recordDetailPdf(notebook.at(-1)),
  daily: bookPdf(
    'Records - Daily overview',
    [
      { kind: 'sales', title: 'Daily sales', rows: sales },
      { kind: 'expenses', title: 'Money out', rows: expenses },
    ],
    [{ label: 'Period', value: 'September 2026' }],
  ),
  categories: bookPdf(
    'Records - Categories',
    [{ kind: 'categories', title: 'Categories', rows: categories }],
    [],
  ),
  trash: bookPdf(
    'Records - Trash',
    [
      { kind: 'sales', title: 'Deleted sales', rows: [{ ...sales[0], deletedAt: '2026-09-02' }] },
      {
        kind: 'expenses',
        title: 'Deleted money out',
        rows: [{ ...expenses[0], deletedAt: '2026-09-02' }],
      },
      {
        kind: 'categories',
        title: 'Deleted categories',
        rows: [{ ...categories[0], deletedAt: '2026-09-02' }],
      },
    ],
    [{ label: 'Status', value: 'Deleted records only' }],
  ),
};
for (const [name, model] of Object.entries(models)) {
  const file = path.join(output, `${name}.pdf`);
  fs.writeFileSync(file, buildBusinessPdf({ ...model, organization: org }));
  console.log(file);
}
