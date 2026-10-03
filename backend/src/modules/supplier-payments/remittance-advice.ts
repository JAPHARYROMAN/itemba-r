import { Prisma } from '@prisma/client';
import type { BusinessPdfModel } from '../generated-documents/pdf-builder';

/**
 * Party linkage (Phase 3 PR-6): a supplier payment rendered as a remittance advice. Pure:
 * the service reads the payment with its allocations; this only shapes the document.
 */
type Decimalish = Prisma.Decimal | number | string;
const money = (value: Decimalish | null | undefined) => new Prisma.Decimal(value ?? 0).toFixed(2);
const day = (value: Date | string) => new Date(value).toISOString().slice(0, 10);

export interface RemittancePayment {
  id: string;
  paymentNumber: string;
  paymentDate: Date;
  amount: Decimalish;
  appliedAmount: Decimalish;
  unappliedAmount: Decimalish;
  currency: string;
  method: string;
  reference: string | null;
  notes?: string | null;
  status: string;
  reversedAt?: Date | null;
  supplier: { id: string; name: string; supplierCode?: string | null };
  company?: { name: string } | null;
  cashAccount?: { accountName: string } | null;
  allocations: Array<{
    id: string;
    amount: Decimalish;
    payable: {
      payableNumber: string;
      amount: Decimalish;
      paidAmount: Decimalish;
      outstandingAmount: Decimalish;
      status: string;
    };
  }>;
}

export function remittancePdf(p: RemittancePayment): Omit<BusinessPdfModel, 'organization'> {
  const fmt = (value: Decimalish | null | undefined) => `${p.currency} ${money(value)}`;
  const allocations = p.allocations ?? [];
  return {
    title: 'Remittance advice',
    subtitle: p.supplier.name,
    reference: p.paymentNumber,
    status: p.reversedAt ? 'REVERSED' : p.status,
    generatedAt: new Date(),
    meta: [
      { label: 'Payment date', value: day(p.paymentDate) },
      { label: 'Method', value: p.method },
      { label: 'Reference', value: p.reference ?? '-' },
    ],
    compactPartyHeader: {
      partyLabel: 'Paid to',
      partyName: p.supplier.name,
      partyDetails: [
        p.supplier.supplierCode ? `Code ${p.supplier.supplierCode}` : null,
        p.company?.name ? `From ${p.company.name}` : null,
      ].filter((v): v is string => !!v),
      documentDetails: [
        { label: 'Payment', value: p.paymentNumber },
        { label: 'Date', value: day(p.paymentDate) },
        { label: 'Method', value: p.method },
        ...(p.reference ? [{ label: 'Reference', value: p.reference }] : []),
        ...(p.cashAccount ? [{ label: 'Paid from', value: p.cashAccount.accountName }] : []),
        { label: 'Amount', value: fmt(p.amount) },
      ],
    },
    sections: [
      {
        title: 'Allocations',
        ...(allocations.length
          ? {
              table: {
                headers: ['Payable', 'Payable amount', 'Paid to date', 'This payment', 'Outstanding now'],
                numericColumns: [1, 2, 3, 4],
                columnWeights: [24, 19, 19, 19, 19],
                rows: allocations.map((a) => [
                  a.payable.payableNumber,
                  money(a.payable.amount),
                  money(a.payable.paidAmount),
                  money(a.amount),
                  money(a.payable.outstandingAmount),
                ]),
              },
            }
          : { paragraphs: ['Payment held on account: no payables were allocated.'] }),
        totals: [
          { label: 'Applied to payables', value: fmt(p.appliedAmount) },
          { label: 'On account (unapplied)', value: fmt(p.unappliedAmount) },
          { label: 'Total paid', value: fmt(p.amount), emphasis: true },
        ],
      },
      ...(p.notes ? [{ title: 'Notes', paragraphs: [p.notes] }] : []),
    ],
    firstPageComplete: true,
  };
}
