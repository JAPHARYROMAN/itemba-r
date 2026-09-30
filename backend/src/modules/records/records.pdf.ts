import { Prisma, RecordEntry } from '@prisma/client';
import { BusinessPdfModel, BusinessPdfSection } from '../generated-documents/pdf-builder';
import { isDebt, presentRecord } from './records.domain';
import { RecordsQuery } from './records.dto';
import { recordsPdfRows } from './records-pdf-rows';

type Row = RecordEntry & {
  company?: { name: string } | null;
  division?: { name: string } | null;
  branch?: { name: string } | null;
};
const labels: Record<string, string> = {
  DEBTOR: 'Debtors',
  CREDITOR: 'Creditors',
  SALE: 'Individual sales',
  PURCHASE: 'Purchases',
  EXPENSE: 'Expense notes',
  NOTE: 'Notes',
};
const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? '-';
const amount = (value: Prisma.Decimal | string) => new Prisma.Decimal(value).toFixed(2);
const basis =
  'Independent Records notebook. Payments and balances here do not update Cash Desk, supplier payables, customer receivables or the general ledger.';

export function recordsPdf(
  rows: Row[],
  query: RecordsQuery,
): Omit<BusinessPdfModel, 'organization'> {
  const sections: BusinessPdfSection[] = [];
  // Separate both register and currency: never net creditors against debtors or add currencies.
  for (const kind of Object.keys(labels)) {
    const currencies = [
      ...new Set(rows.filter((r) => r.kind === kind).map((r) => r.currency)),
    ].sort();
    for (const currency of currencies) {
      const group = rows
        .filter((r) => r.kind === kind && r.currency === currency)
        .map(presentRecord);
      const debt = isDebt(kind);
      const note = kind === 'NOTE';
      const headers = note
        ? ['Date', 'Title / category', 'Notes', 'Organisation', 'Status']
        : [
            'Date',
            'Record / party',
            'Reference / due date',
            'Organisation',
            'Amount',
            ...(debt ? ['Settled', 'Balance'] : []),
            'Status',
          ];
      const sum = (key: 'amount' | 'settledAmount' | 'balance') =>
        group.reduce((total, r) => total.plus(r[key]), new Prisma.Decimal(0)).toFixed(2);
      sections.push({
        title: `${labels[kind]}${note ? '' : ` - ${currency}`}`,
        paragraphs: [
          `${group.length} matching records.`,
          ...(debt
            ? [
                'Balances and settlements are current; the date filter selects the original records.',
              ]
            : []),
        ],
        table: {
          headers,
          stripedRows: true,
          numericColumns: note ? [] : debt ? [4, 5, 6] : [4],
          columnWeights: note
            ? [12, 22, 40, 18, 8]
            : debt
              ? [11, 22, 14, 17, 10, 10, 10, 8]
              : [11, 26, 17, 22, 14, 10],
          rows: recordsPdfRows(
            group.map((r) => {
              const scope =
                [r.company?.name, r.division?.name, r.branch?.name].filter(Boolean).join(' / ') ||
                'Personal';
              return note
                ? [
                    date(r.recordDate),
                    [r.title, r.category].filter(Boolean).join('\n'),
                    r.notes || '-',
                    scope,
                    r.status,
                  ]
                : [
                    date(r.recordDate),
                    [r.title, r.counterparty, r.category].filter(Boolean).join('\n'),
                    [r.reference, r.dueDate ? `Due ${date(r.dueDate)}` : null]
                      .filter(Boolean)
                      .join('\n') || '-',
                    scope,
                    amount(r.amount),
                    ...(debt ? [amount(r.settledAmount), r.balance] : []),
                    r.status,
                  ];
            }),
          ),
        },
        totals: note
          ? undefined
          : [
              { label: `Recorded amount (${currency})`, value: sum('amount') },
              ...(debt
                ? [
                    { label: `Settled (${currency})`, value: sum('settledAmount') },
                    { label: `Outstanding (${currency})`, value: sum('balance'), emphasis: true },
                  ]
                : []),
            ],
      });
    }
  }
  if (!sections.length)
    sections.push({ title: 'Records', paragraphs: ['No records match these filters.'] });
  sections.push({ title: 'Basis', paragraphs: [basis] });
  return {
    title: `Records - ${labels[query.kind ?? ''] ?? 'Notebook'}`,
    reference: 'RECORDS-REGISTER',
    generatedAt: new Date(),
    orientation: 'landscape',
    meta: [
      {
        label: 'Record dates',
        value: `${query.from || 'Beginning'} to ${query.to || 'Latest record'}`,
      },
      {
        label: 'Status',
        value: query.status === 'void' ? 'Voided records' : query.status || 'all',
      },
      { label: 'Currency', value: query.currency || 'Separate totals by currency' },
      { label: 'Search', value: query.search || 'All records' },
      {
        label: 'Scope',
        value:
          query.scope === 'personal'
            ? 'Personal only'
            : [query.companyId, query.divisionId, query.branchId].filter(Boolean).join(' / ') ||
              'All accessible records',
      },
    ],
    sections,
  };
}

export function recordDetailPdf(raw: Row): Omit<BusinessPdfModel, 'organization'> {
  const r = presentRecord(raw);
  return {
    title: `Records - ${labels[r.kind]}`,
    subtitle: r.title,
    reference: r.reference || `REC-${r.id.slice(0, 8)}`,
    status: r.status,
    generatedAt: new Date(),
    meta: [{ label: 'Record date', value: date(r.recordDate) }],
    sections: [
      {
        title: 'Record details',
        items: [
          { label: 'Person / business', value: r.counterparty || '-' },
          { label: 'Contact', value: r.contact || '-' },
          { label: 'Category', value: r.category || '-' },
          {
            label: 'Organisation',
            value:
              [r.company?.name, r.division?.name, r.branch?.name].filter(Boolean).join(' / ') ||
              'Personal',
          },
          ...(r.kind === 'NOTE'
            ? []
            : [{ label: 'Amount', value: `${r.currency} ${amount(r.amount)}` }]),
        ],
      },
      {
        title: 'Notes',
        table: { headers: ['Notes'], rows: recordsPdfRows([[r.notes || 'No notes.']]) },
      },
      { title: 'Basis', paragraphs: [basis] },
    ],
  };
}
