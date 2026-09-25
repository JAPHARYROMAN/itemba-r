import { Prisma, RecordPosting } from '@prisma/client';
import { BusinessPdfModel } from '../generated-documents/pdf-builder';
import { csvCell } from './records.domain';

export function statementRows(
  kind: string,
  postings: Pick<RecordPosting, 'id' | 'date' | 'delta' | 'description' | 'reference' | 'kind'>[],
  from: string | undefined,
  to: string,
) {
  let balance = new Prisma.Decimal(0),
    opening = new Prisma.Decimal(0);
  let debits = new Prisma.Decimal(0),
    credits = new Prisma.Decimal(0);
  const rows: {
    id: string;
    date: string;
    kind: string;
    description: string;
    reference: string | null;
    debit: string;
    credit: string;
    balance: string;
  }[] = [];
  for (const p of postings) {
    const date = p.date.toISOString().slice(0, 10);
    if (date > to) continue;
    balance = balance.plus(p.delta);
    if (from && date < from) {
      opening = balance;
      continue;
    }
    const signedDebit = kind === 'DEBTOR' ? p.delta : p.delta.negated();
    const debit = Prisma.Decimal.max(signedDebit, 0),
      credit = Prisma.Decimal.max(signedDebit.negated(), 0);
    debits = debits.plus(debit);
    credits = credits.plus(credit);
    rows.push({
      id: p.id,
      date,
      kind: p.kind,
      description: p.description,
      reference: p.reference,
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      balance: balance.toFixed(2),
    });
  }
  return {
    openingBalance: opening.toFixed(2),
    closingBalance: balance.toFixed(2),
    totalDebit: debits.toFixed(2),
    totalCredit: credits.toFixed(2),
    balanceSide: kind === 'DEBTOR' ? 'Dr' : 'Cr',
    rows,
  };
}

type Statement = ReturnType<typeof statementRows> & {
  from: string | null;
  to: string;
  startsOn: string | null;
  record: {
    id: string;
    kind: string;
    title: string;
    counterparty: string | null;
    contact: string | null;
    currency: string;
    reference: string | null;
    dueDate: Date | null;
    company?: { name: string } | null;
    division?: { name: string } | null;
    branch?: { name: string } | null;
  };
};
const formatted = (v: string) =>
  new Prisma.Decimal(v)
    .toNumber()
    .toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sided = (s: Statement, v: string) =>
  `${formatted(new Prisma.Decimal(v).abs().toFixed(2))} ${new Prisma.Decimal(v).isNegative() ? (s.balanceSide === 'Dr' ? 'Cr' : 'Dr') : s.balanceSide}`;
export function statementCsv(s: Statement) {
  return (
    '\uFEFF' +
    [
      ['Records statement', s.record.kind === 'DEBTOR' ? 'Debtor' : 'Creditor'],
      ['Party', s.record.counterparty],
      ['Record', s.record.title],
      ['Record ID', s.record.id],
      ['Company', s.record.company?.name ?? 'Itemba Group'],
      ['Division', s.record.division?.name],
      ['Branch', s.record.branch?.name],
      ['Currency', s.record.currency],
      ['From', s.from ?? 'Beginning'],
      ['To', s.to],
      ...(s.startsOn
        ? [
            [
              'History',
              `Opening balance brought forward on ${s.startsOn}; earlier payments are in payment history.`,
            ],
          ]
        : []),
      ['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance owed', 'Balance side'],
      [s.from ?? '', 'Opening balance', '', '', '', s.openingBalance, s.balanceSide],
      ...s.rows.map((r) => [
        r.date,
        r.description,
        r.reference,
        r.debit,
        r.credit,
        r.balance,
        s.balanceSide,
      ]),
      [s.to, 'Closing balance', '', s.totalDebit, s.totalCredit, s.closingBalance, s.balanceSide],
      ['Basis', 'Individual Records debt; independent of the ERP general ledger.'],
    ]
      .map((r) => r.map(csvCell).join(','))
      .join('\r\n')
  );
}
export function statementPdf(s: Statement): Omit<BusinessPdfModel, 'organization'> {
  const r = s.record;
  return {
    title: r.kind === 'DEBTOR' ? 'Debtor statement' : 'Creditor statement',
    subtitle: r.title,
    reference: r.reference || `REC-${r.id.slice(0, 8).toUpperCase()}`,
    generatedAt: new Date(),
    meta: [
      { label: 'Period', value: `${s.from ?? 'Beginning'} to ${s.to}` },
      { label: 'Currency', value: r.currency },
    ],
    compactPartyHeader: {
      partyLabel: r.kind === 'DEBTOR' ? 'Debtor' : 'Creditor',
      partyName: r.counterparty ?? r.title,
      partyDetails: [`Record: ${r.title}`, r.contact, r.division?.name, r.branch?.name].filter(
        (v): v is string => !!v,
      ),
      documentDetails: [
        { label: 'Period', value: `${s.from ?? 'Beginning'} to ${s.to}` },
        { label: 'Currency', value: r.currency },
        ...(r.dueDate ? [{ label: 'Due date', value: r.dueDate.toISOString().slice(0, 10) }] : []),
      ],
    },
    sections: [
      {
        title: 'Account activity',
        paragraphs: [
          r.kind === 'DEBTOR'
            ? 'Debits increase the amount owed to you. Credits record payments received or reductions.'
            : 'Credits increase the amount you owe. Debits record payments made or reductions.',
          ...(s.startsOn
            ? [
                `Statement history begins on ${s.startsOn} with a brought-forward balance. Earlier payments remain in the record history.`,
              ]
            : []),
        ],
        table: {
          headers: ['Date', 'Description / reference', 'Debit', 'Credit', 'Balance'],
          numericColumns: [2, 3, 4],
          columnWeights: [14, 35, 16, 16, 19],
          rows: [
            [s.from ?? 'Beginning', 'Opening balance', '-', '-', sided(s, s.openingBalance)],
            ...s.rows.map((p) => [
              p.date,
              [p.description, p.reference].filter(Boolean).join(' / '),
              p.debit === '0.00' ? '-' : formatted(p.debit),
              p.credit === '0.00' ? '-' : formatted(p.credit),
              sided(s, p.balance),
            ]),
          ],
        },
        totals: [
          { label: 'Total debit', value: `${r.currency} ${formatted(s.totalDebit)}` },
          { label: 'Total credit', value: `${r.currency} ${formatted(s.totalCredit)}` },
          {
            label: r.kind === 'DEBTOR' ? 'Balance owed to you' : 'Balance you owe',
            value: `${r.currency} ${sided(s, s.closingBalance)}`,
            emphasis: true,
          },
        ],
      },
      {
        title: 'Statement basis',
        paragraphs: [
          'This statement covers this individual Records debt and its recorded payments. Records is independent of the ERP general ledger.',
        ],
      },
    ],
  };
}
