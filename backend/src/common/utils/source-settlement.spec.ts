import { Prisma } from '@prisma/client';
import {
  settlementStatusFilter,
  sourceSettlement,
  withSettlementLifecycle,
} from './source-settlement';

describe('canonical source settlement', () => {
  it('retains noncash forgiveness separately from actual cash and settles order outstanding', () => {
    const result = sourceSettlement(100, {
      amount: 100,
      paidAmount: 30,
      outstandingAmount: 0,
      status: 'WRITTEN_OFF',
    });
    expect(result.paidAmount.toString()).toBe('30');
    expect(result.outstandingAmount.toString()).toBe('0');
    expect(result.settlementAdjustmentAmount.toString()).toBe('70');
    expect(result.paymentStatus).toBe('PARTIALLY_PAID');
    expect(result.settlementStatus).toBe('WRITTEN_OFF');
  });

  it('preserves uncovered order value for a partial invoice', () => {
    const result = sourceSettlement(100, { amount: 60, paidAmount: 20, outstandingAmount: 30 });
    expect(result.unbilledAmount.toString()).toBe('40');
    expect(result.outstandingAmount.toString()).toBe('70');
    expect(result.settlementAdjustmentAmount.toString()).toBe('10');
  });

  it('flags amounts exceeding source value and deleted canonical documents', () => {
    expect(
      sourceSettlement(100, { amount: 120, paidAmount: 0, outstandingAmount: 120 })
        .settlementConflict,
    ).toBe(true);
    expect(
      sourceSettlement(100, {
        amount: 100,
        paidAmount: 100,
        outstandingAmount: 0,
        deletedAt: new Date(),
      }).settlementConflict,
    ).toBe(true);
  });
});

describe('settlement lifecycle projection', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-08T12:00:00Z')));
  afterEach(() => jest.useRealTimers());
  const row = {
    amount: 100,
    paidAmount: 30,
    outstandingAmount: 70,
    status: 'PARTIALLY_PAID',
    dueDate: new Date('2026-10-07T23:00:00Z'),
  };

  it('derives overdue without changing stored payment lifecycle', () => {
    expect(withSettlementLifecycle(row)).toEqual(
      expect.objectContaining({
        status: 'OVERDUE',
        lifecycleStatus: 'PARTIALLY_PAID',
        isOverdue: true,
        canDelete: false,
      }),
    );
    expect(
      withSettlementLifecycle({ ...row, dueDate: new Date('2026-10-08T00:00:00Z') }).isOverdue,
    ).toBe(false);
    expect(
      withSettlementLifecycle({ ...row, status: 'WRITTEN_OFF', outstandingAmount: 0 }).status,
    ).toBe('WRITTEN_OFF');
  });

  it('excludes future payments from the overdue predicate and makes no calendar-day timestamp comparisons', () => {
    expect(settlementStatusFilter('OVERDUE')).toEqual({
      status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
      outstandingAmount: { gt: 0 },
      dueDate: { lt: new Date('2026-10-08T00:00:00Z') },
    });
  });

  it('exposes noncash reductions and blocks ordinary deletion of posted or linked documents', () => {
    const writtenOff = withSettlementLifecycle({
      ...row,
      status: 'WRITTEN_OFF',
      outstandingAmount: 0,
    });
    expect(writtenOff.settlementAdjustmentAmount.eq(new Prisma.Decimal(70))).toBe(true);
    expect(withSettlementLifecycle({ ...row, paidAmount: 0, _count: { trips: 1 } }).canDelete).toBe(
      false,
    );
    expect(
      withSettlementLifecycle({ ...row, paidAmount: 0, journalEntryId: 'je-1' }).canDelete,
    ).toBe(false);
    expect(withSettlementLifecycle({ ...row, paidAmount: 0, sourceId: 'so-1' }).canDelete).toBe(
      false,
    );
    expect(withSettlementLifecycle({ ...row, paidAmount: 0, sourceType: null }).canDelete).toBe(
      true,
    );
  });
});
