// Non-business fixture for visual PDF review. No database or network writes.
const path = require('node:path');
const fs = require('node:fs');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
require('ts-node/register/transpile-only');
const { Prisma } = require('@prisma/client');
const { statementRows, statementPdf } = require('../src/modules/records/records.statement');
const { buildBusinessPdf } = require('../src/modules/generated-documents/pdf-builder');
const rows = [
  {
    id: 'opening',
    kind: 'DEBT',
    date: new Date('2026-01-01'),
    delta: new Prisma.Decimal('1250000.30'),
    description: 'Debt recorded',
    reference: 'TEST-INVOICE-001',
  },
];
for (let i = 1; i <= 34; i++)
  rows.push({
    id: `payment-${i}`,
    kind: 'PAYMENT',
    date: new Date(Date.UTC(2026, 0, i + 1)),
    delta: new Prisma.Decimal('-10000.10'),
    description: 'Payment made',
    reference: `TEST-BANK-${String(i).padStart(3, '0')}`,
  });
rows.push({
  id: 'reversal',
  kind: 'REVERSAL',
  date: new Date('2026-02-06'),
  delta: new Prisma.Decimal('10000.10'),
  description: 'Payment reversed: incorrect bank reference; retained for a complete history',
  reference: 'TEST-BANK-034',
});
const s = {
  ...statementRows('CREDITOR', rows, undefined, '2026-02-28'),
  from: null,
  to: '2026-02-28',
  startsOn: null,
  record: {
    id: '00000000-test-4000-8000-000000000001',
    kind: 'CREDITOR',
    title: 'TEST ONLY - supplier purchases and partial payments',
    counterparty: 'Example Supplies Limited (test fixture)',
    contact: 'Accounts department - example.invalid',
    currency: 'TZS',
    reference: 'TEST-STATEMENT-001',
    dueDate: new Date('2026-02-28'),
  },
};
const model = statementPdf(s);
const output = path.resolve(__dirname, '../../tmp/pdfs/records-statement-fixture.pdf');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  buildBusinessPdf({
    ...model,
    organization: {
      name: 'ITEMBA GROUP',
      address: 'Test letterhead - visual verification only',
      logoText: 'IG',
    },
  }),
);
console.log(output);
