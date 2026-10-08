import { PaymentStatus, Prisma } from '@prisma/client';

type Money = Prisma.Decimal | number | string;
export const canonicalSettlementSelect = {
  id: true,
  companyId: true,
  currency: true,
  amount: true,
  paidAmount: true,
  outstandingAmount: true,
  status: true,
  deletedAt: true,
  journalEntryId: true,
} as const;
export type CanonicalSettlement = {
  amount?: Money;
  paidAmount: Money;
  outstandingAmount: Money;
  status?: string;
  deletedAt?: Date | null;
};

/** Cash, non-cash relief, and uncovered source value remain separate measures. */
export function sourceSettlement(totalValue: Money, canonical: CanonicalSettlement) {
  const total = new Prisma.Decimal(totalValue).toDecimalPlaces(2);
  const amount = new Prisma.Decimal(canonical.amount ?? total).toDecimalPlaces(2);
  const paid = Prisma.Decimal.min(total, new Prisma.Decimal(canonical.paidAmount)).toDecimalPlaces(
    2,
  );
  const relief = Prisma.Decimal.max(
    0,
    amount.minus(canonical.paidAmount).minus(canonical.outstandingAmount),
  );
  const adjustment = Prisma.Decimal.min(Prisma.Decimal.max(0, total.minus(paid)), relief);
  const outstanding = Prisma.Decimal.max(0, total.minus(paid).minus(adjustment));
  const paymentStatus = paid.gte(total)
    ? PaymentStatus.PAID
    : paid.gt(0)
      ? PaymentStatus.PARTIALLY_PAID
      : PaymentStatus.UNPAID;
  return {
    paidAmount: paid,
    outstandingAmount: outstanding,
    settlementAdjustmentAmount: adjustment.toDecimalPlaces(2),
    unbilledAmount: Prisma.Decimal.max(0, total.minus(amount)).toDecimalPlaces(2),
    paymentStatus,
    settlementStatus:
      canonical.status === 'WRITTEN_OFF' && outstanding.isZero()
        ? 'WRITTEN_OFF'
        : outstanding.isZero() && adjustment.gt(0)
          ? 'SETTLED'
          : paymentStatus,
    settlementConflict:
      amount.gt(total) || Boolean(canonical.deletedAt) || canonical.status === 'CANCELLED',
  };
}

export function utcToday(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function withSettlementLifecycle<
  T extends {
    status: string;
    dueDate?: Date | null;
    outstandingAmount: Money;
    paidAmount: Money;
    amount?: Money;
    sourceType?: string | null;
    sourceId?: string | null;
    journalEntryId?: string | null;
    _count?: Record<string, number>;
  },
>(record: T) {
  const open = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'].includes(record.status);
  const isOverdue =
    open &&
    new Prisma.Decimal(record.outstandingAmount).gt(0) &&
    Boolean(record.dueDate && record.dueDate < utcToday());
  return {
    ...record,
    lifecycleStatus: record.status,
    settlementAdjustmentAmount:
      record.status === 'CANCELLED'
        ? new Prisma.Decimal(0)
        : Prisma.Decimal.max(
            0,
            new Prisma.Decimal(record.amount ?? 0)
              .minus(record.paidAmount)
              .minus(record.outstandingAmount),
          ).toDecimalPlaces(2),
    isOverdue,
    status: open
      ? isOverdue
        ? 'OVERDUE'
        : new Prisma.Decimal(record.paidAmount).gt(0)
          ? 'PARTIALLY_PAID'
          : 'OPEN'
      : record.status,
    canDelete:
      !record.journalEntryId &&
      !record.sourceType &&
      !record.sourceId &&
      !Object.values(record._count ?? {}).some((count) => count > 0) &&
      new Prisma.Decimal(record.paidAmount).isZero() &&
      open,
  };
}

export function settlementStatusFilter(status?: string) {
  if (!status) return {};
  if (status === 'OVERDUE')
    return {
      status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
      outstandingAmount: { gt: 0 },
      dueDate: { lt: utcToday() },
    };
  if (status === 'OPEN' || status === 'PARTIALLY_PAID')
    return {
      status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
      outstandingAmount: { gt: 0 },
      paidAmount: status === 'OPEN' ? { equals: 0 } : { gt: 0 },
      OR: [{ dueDate: null }, { dueDate: { gte: utcToday() } }],
    };
  return { status };
}
