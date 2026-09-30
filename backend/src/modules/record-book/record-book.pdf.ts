import { Prisma } from '@prisma/client';
import { BusinessPdfModel, BusinessPdfSection } from '../generated-documents/pdf-builder';
import { recordsPdfRows } from '../records/records-pdf-rows';

export interface BookPdfRow {
  id: string;
  name?: string;
  description?: string | null;
  notes?: string | null;
  recordDate?: Date | string;
  deletedAt?: Date | string | null;
  currency?: string;
  totalSalesAmount?: number;
  amount?: number;
  status?: string;
  isActive?: boolean;
  paidTo?: string | null;
  reference?: string | null;
  paymentMethod?: string;
  company?: { name: string };
  division?: { name: string } | null;
  branch?: { name: string } | null;
  expenseCategory?: { name: string };
  receipts?: {
    receiptType: string;
    label?: string | null;
    amount: number;
    reference?: string | null;
    notes?: string | null;
  }[];
}
export type BookPdfGroup = {
  title: string;
  kind: 'sales' | 'expenses' | 'categories';
  rows: BookPdfRow[];
};
const day = (value?: Date | string | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : '-';
const money = (value?: number) => new Prisma.Decimal(value ?? 0).toFixed(2);
const scope = (row: BookPdfRow) =>
  [row.company?.name, row.division?.name, row.branch?.name].filter(Boolean).join(' / ');

export function bookPdf(
  title: string,
  groups: BookPdfGroup[],
  meta: BusinessPdfModel['meta'],
  detail = false,
): Omit<BusinessPdfModel, 'organization'> {
  const sections: BusinessPdfSection[] = groups.map((group) => {
    const category = group.kind === 'categories';
    const sales = group.kind === 'sales';
    const totals = new Map<string, Prisma.Decimal>();
    if (!category)
      for (const row of group.rows) {
        const currency = row.currency || 'Unspecified';
        totals.set(
          currency,
          (totals.get(currency) ?? new Prisma.Decimal(0)).plus(
            sales ? (row.totalSalesAmount ?? 0) : (row.amount ?? 0),
          ),
        );
      }
    return {
      title: group.title,
      paragraphs: [
        group.rows.length ? `${group.rows.length} matching records.` : 'No matching records.',
      ],
      table: {
        headers: category
          ? ['Category', 'Description', 'Company', 'Status', 'Deleted on']
          : [
              'Date',
              'Organisation',
              sales ? 'Receipts / references' : 'Description / payee',
              'Currency',
              sales ? 'Sales amount' : 'Money out',
              'Status',
              'Deleted on',
            ],
        columnWeights: category ? [25, 30, 25, 10, 10] : [11, 24, 30, 9, 13, 11, 11],
        numericColumns: category ? [] : [4],
        stripedRows: true,
        rows: recordsPdfRows(
          group.rows.map((row) =>
            category
              ? [
                  row.name || '-',
                  row.description || '-',
                  row.company?.name || '-',
                  row.isActive ? 'Active' : 'Inactive',
                  day(row.deletedAt),
                ]
              : [
                  day(row.recordDate),
                  scope(row),
                  sales
                    ? (row.receipts || [])
                        .map((r) =>
                          [
                            r.receiptType.replaceAll('_', ' '),
                            r.label,
                            money(r.amount),
                            r.reference,
                          ]
                            .filter(Boolean)
                            .join(' / '),
                        )
                        .join('; ') || 'No receipts recorded'
                    : [
                        row.description,
                        row.expenseCategory?.name,
                        row.paidTo,
                        row.paymentMethod?.replaceAll('_', ' '),
                        row.reference,
                      ]
                        .filter(Boolean)
                        .join('\n'),
                  row.currency || '-',
                  money(sales ? row.totalSalesAmount : row.amount),
                  row.status || '-',
                  day(row.deletedAt),
                ],
          ),
        ),
      },
      totals: [...totals].map(([currency, value]) => ({
        label: `${sales ? 'Recorded sales' : 'Money out'} (${currency})`,
        value: value.toFixed(2),
      })),
    };
  });
  if (detail)
    for (const group of groups)
      for (const row of group.rows) {
        sections.push({
          title: 'Notes',
          table: {
            headers: ['Notes'],
            rows: recordsPdfRows([
              [row.notes || 'No notes.'],
              ...(row.receipts || [])
                .filter((r) => r.notes)
                .map((r) => [`${r.label || r.receiptType}: ${r.notes}`]),
            ]),
          },
        });
      }
  sections.push({
    title: 'Basis',
    paragraphs: [
      'Independent daily records. Daily sales and money out keep separate totals by currency. Deleted and voided records are history, not active balances. These entries do not post to accounting or cash accounts.',
    ],
  });
  return {
    title,
    reference: detail ? groups[0]?.rows[0]?.id || 'RECORDS' : 'RECORDS-DAILY',
    generatedAt: new Date(),
    orientation: 'landscape',
    meta,
    sections,
  };
}
