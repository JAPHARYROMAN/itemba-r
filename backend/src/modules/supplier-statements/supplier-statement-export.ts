import { Prisma } from '@prisma/client';
import type { BusinessPdfModel } from '../generated-documents/pdf-builder';

/**
 * Party linkage (Phase 3 PR-6): a statement run's period rendered as a document. Pure: the
 * service reads the run and its period's payables and payments; these builders only shape
 * them. The run's recorded balances attribute settlements to the payable's own period (so
 * they reconcile with the payables ledger); the activity lists payables by issue date and
 * payments by payment date, and says so when the two closings differ.
 */
type Decimalish = Prisma.Decimal | number | string;
const ZERO = new Prisma.Decimal(0);
const money = (value: Decimalish | null | undefined) => new Prisma.Decimal(value ?? 0).toFixed(2);
const day = (value: Date | string) => new Date(value).toISOString().slice(0, 10);

export interface StatementRunRow {
  id: string;
  statementRunNumber: string;
  companyId: string;
  supplierId: string | null;
  periodStart: Date;
  periodEnd: Date;
  openingBalance: Decimalish;
  totalDebits: Decimalish;
  totalCredits: Decimalish;
  closingBalance: Decimalish;
  currency: string;
  generatedAt: Date;
  status: string;
  company?: { id: string; name: string; code?: string | null } | null;
}
export interface StatementPayable {
  id: string;
  payableNumber: string;
  issueDate: Date;
  amount: Decimalish;
  supplierName?: string | null;
}
export interface StatementPayment {
  id: string;
  paymentNumber: string;
  paymentDate: Date;
  amount: Decimalish;
  method: string;
  reference: string | null;
  supplier?: { name: string } | null;
}
export interface StatementParty {
  id: string;
  name: string;
  supplierCode?: string | null;
}
export interface StatementLine {
  date: string;
  type: 'PAYABLE' | 'PAYMENT';
  reference: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}
export interface SupplierStatementExport {
  run: StatementRunRow;
  supplier: StatementParty | null;
  lines: StatementLine[];
  activity: { debits: string; credits: string; closing: string };
}

export function buildSupplierStatement(
  run: StatementRunRow,
  supplier: StatementParty | null,
  payables: StatementPayable[],
  payments: StatementPayment[],
): SupplierStatementExport {
  const events = [
    ...payables.map((p) => ({
      date: p.issueDate,
      type: 'PAYABLE' as const,
      reference: p.payableNumber,
      description: supplier ? 'Payable raised' : `Payable raised · ${p.supplierName ?? 'Supplier'}`,
      debit: new Prisma.Decimal(p.amount),
      credit: ZERO,
      order: 0,
    })),
    ...payments.map((p) => ({
      date: p.paymentDate,
      type: 'PAYMENT' as const,
      reference: p.paymentNumber,
      description: [
        'Payment',
        p.method,
        p.reference ? `ref ${p.reference}` : null,
        supplier ? null : p.supplier?.name,
      ]
        .filter(Boolean)
        .join(' · '),
      debit: ZERO,
      credit: new Prisma.Decimal(p.amount),
      order: 1,
    })),
  ].sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      a.order - b.order ||
      a.reference.localeCompare(b.reference),
  );
  let balance = new Prisma.Decimal(run.openingBalance ?? 0);
  let debits = ZERO;
  let credits = ZERO;
  const lines = events.map((e) => {
    balance = balance.plus(e.debit).minus(e.credit);
    debits = debits.plus(e.debit);
    credits = credits.plus(e.credit);
    return {
      date: day(e.date),
      type: e.type,
      reference: e.reference,
      description: e.description,
      debit: money(e.debit),
      credit: money(e.credit),
      balance: money(balance),
    };
  });
  return {
    run,
    supplier,
    lines,
    activity: { debits: money(debits), credits: money(credits), closing: money(balance) },
  };
}

export function supplierStatementCsv(s: SupplierStatementExport): string {
  const cell = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const rows: string[][] = [
    ['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
    [
      day(s.run.periodStart),
      'OPENING',
      s.run.statementRunNumber,
      'Opening balance (recorded)',
      '',
      '',
      money(s.run.openingBalance),
    ],
    ...s.lines.map((l) => [l.date, l.type, l.reference, l.description, l.debit, l.credit, l.balance]),
    [
      day(s.run.periodEnd),
      'CLOSING',
      s.run.statementRunNumber,
      'Closing balance (recorded)',
      money(s.run.totalDebits),
      money(s.run.totalCredits),
      money(s.run.closingBalance),
    ],
  ];
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

export function supplierStatementPdf(s: SupplierStatementExport): Omit<BusinessPdfModel, 'organization'> {
  const partyName = s.supplier?.name ?? 'All suppliers';
  const period = `${day(s.run.periodStart)} to ${day(s.run.periodEnd)}`;
  const fmt = (value: Decimalish | null | undefined) => `${s.run.currency} ${money(value)}`;
  const dash = (value: string) => (value === '0.00' ? '-' : value);
  const recordedMatchesActivity = money(s.run.closingBalance) === s.activity.closing;
  return {
    title: 'Supplier statement',
    subtitle: partyName,
    reference: s.run.statementRunNumber,
    status: s.run.status,
    generatedAt: new Date(),
    meta: [
      { label: 'Period', value: period },
      { label: 'Currency', value: s.run.currency },
      { label: 'Statement generated', value: day(s.run.generatedAt) },
    ],
    compactPartyHeader: {
      partyLabel: 'Supplier',
      partyName,
      partyDetails: [
        s.supplier?.supplierCode ? `Code ${s.supplier.supplierCode}` : null,
        s.run.company?.name ? `Company ${s.run.company.name}` : null,
      ].filter((v): v is string => !!v),
      documentDetails: [
        { label: 'Period', value: period },
        { label: 'Currency', value: s.run.currency },
        { label: 'Statement', value: s.run.statementRunNumber },
      ],
    },
    sections: [
      {
        title: 'Recorded balances',
        items: [
          { label: 'Opening balance', value: fmt(s.run.openingBalance) },
          { label: 'Payables raised', value: fmt(s.run.totalDebits) },
          { label: 'Settlements', value: fmt(s.run.totalCredits) },
          { label: 'Closing balance', value: fmt(s.run.closingBalance) },
        ],
        paragraphs: [
          'Recorded balances attribute each payable and its settlement to the period the payable was raised in, so they reconcile with the payables ledger. The activity below lists payables by issue date and payments by payment date.',
        ],
      },
      {
        title: 'Account activity',
        table: {
          headers: ['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
          numericColumns: [3, 4, 5],
          columnWeights: [12, 16, 34, 12, 12, 14],
          rows: [
            [day(s.run.periodStart), '-', 'Opening balance', '-', '-', money(s.run.openingBalance)],
            ...s.lines.map((l) => [
              l.date,
              l.reference,
              l.description,
              dash(l.debit),
              dash(l.credit),
              l.balance,
            ]),
          ],
        },
        totals: [
          { label: 'Payables raised in period', value: fmt(s.activity.debits) },
          { label: 'Payments in period', value: fmt(s.activity.credits) },
          { label: 'Balance after activity', value: fmt(s.activity.closing), emphasis: true },
          ...(recordedMatchesActivity
            ? []
            : [{ label: 'Recorded closing balance', value: fmt(s.run.closingBalance) }]),
        ],
      },
    ],
    firstPageComplete: true,
    continuationTitle: 'Account activity (continued)',
  };
}
