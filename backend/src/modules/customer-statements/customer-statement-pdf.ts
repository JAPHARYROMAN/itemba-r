import { Prisma } from '@prisma/client';
import { BusinessPdfModel } from '../generated-documents/pdf-builder';
import { CustomerStatement } from './statement.types';

const amount = (value: Prisma.Decimal | number | string) => {
  const [whole, cents] = new Prisma.Decimal(value).toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
};
const day = (value: Date) => value.toISOString().slice(0, 10);
const balance = (value: Prisma.Decimal) =>
  `${amount(value.abs())} ${value.isNegative() ? 'Cr' : 'Dr'}`;

/** Shared business-document painter gives aligned columns and repeated page headers. */
export function customerStatementPdf(s: CustomerStatement): BusinessPdfModel {
  return {
    title: 'Statement of Account',
    subtitle: s.customerName ?? s.customerId,
    reference: s.statementRunNumber ?? `PREVIEW-${s.customerId.slice(0, 8).toUpperCase()}`,
    status: s.runId ? 'ISSUED' : 'PREVIEW',
    organization: {
      name: s.company?.name ?? 'Itemba Group',
      companyName: s.company?.name,
      code: s.company?.code,
      address: s.company?.address,
      email: s.company?.email,
      phone: s.company?.phone,
    },
    generatedAt: s.generatedAt,
    meta: [
      { label: 'Period', value: `${day(s.dateFrom)} to ${day(s.dateTo)}` },
      { label: 'Currency', value: s.currency },
    ],
    compactPartyHeader: {
      partyLabel: 'Customer',
      partyName: s.customerName ?? s.customerId,
      partyDetails: [
        s.customer?.customerCode,
        s.customer?.address,
        s.customer?.email,
        s.customer?.phone,
      ].filter((v): v is string => !!v),
      documentDetails: [
        { label: 'Statement', value: s.statementRunNumber ?? 'Preview' },
        { label: 'Period', value: `${day(s.dateFrom)} to ${day(s.dateTo)}` },
        { label: 'Currency', value: s.currency },
        {
          label: 'Coverage',
          value: s.scope?.branchId
            ? 'Selected branch'
            : s.scope?.divisionId
              ? 'Selected division'
              : s.scope?.unrestricted
                ? 'Company customer account'
                : 'Authorized divisions / branches',
        },
      ],
    },
    sections: [
      {
        title: 'Account activity',
        table: {
          headers: ['Date', 'Description / reference', 'Debit', 'Credit', 'Balance'],
          numericColumns: [2, 3, 4],
          columnWeights: [13, 39, 15, 15, 18],
          stripedRows: true,
          rows: [
            [
              day(s.dateFrom),
              'Opening balance brought forward',
              '-',
              '-',
              balance(s.openingBalance),
            ],
            ...s.lines.map((line) => [
              day(line.date),
              `${line.description} / ${line.reference}`,
              line.debit.isZero() ? '-' : amount(line.debit),
              line.credit.isZero() ? '-' : amount(line.credit),
              balance(line.balance),
            ]),
            [
              day(s.dateTo),
              'Closing balance carried forward',
              amount(s.totalDebits),
              amount(s.totalCredits),
              balance(s.closingBalance),
            ],
          ],
        },
        totals: [
          { label: 'Total debits', value: `${s.currency} ${amount(s.totalDebits)}` },
          { label: 'Total credits', value: `${s.currency} ${amount(s.totalCredits)}` },
          {
            label: 'Net account balance',
            value: `${s.currency} ${balance(s.closingBalance)}`,
            emphasis: true,
          },
        ],
      },
      {
        title: `Invoice aging at ${day(s.dateTo)}`,
        keepTogether: true,
        table: {
          headers: ['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'],
          numericColumns: [0, 1, 2, 3, 4],
          rows: [
            [
              s.aging.current,
              s.aging.days1_30,
              s.aging.days31_60,
              s.aging.days61_90,
              s.aging.over90,
            ].map(amount),
          ],
        },
        totals: [
          {
            label: 'Open invoice balance',
            value: `${s.currency} ${amount(s.openInvoiceBalance ?? s.aging.total)}`,
          },
          {
            label: 'Customer credit / deposits',
            value: `${s.currency} ${amount(s.customerCredit ?? 0)}`,
          },
        ],
      },
      {
        title: 'Statement basis',
        paragraphs: [
          'Debits increase the amount due. Credits record receipts or reductions. A credit balance is money on the customer account.',
          'This statement covers ERP business sales and receivables in the stated company, currency and authorized organizational scope. Standalone Direct Sales are held separately.',
          'Invoices use their posted accounting dates. Aging uses recorded due dates; changes to customer ownership or payment terms require reconciliation before issue.',
          ...(s.warnings ?? []),
        ],
      },
    ],
  };
}
