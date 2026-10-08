import { describe, expect, it } from 'vitest';
import {
  accountingCoverageLabel,
  canDeleteFinancialDocument,
  canSettleFinancialDocument,
  financialAgingBucket,
  financialDocumentStatus,
  formatFinancialTotals,
  isFinancialDocumentOverdue,
  settlementLabel,
} from './financial-document';

describe('financial document presentation', () => {
  const asOf = new Date('2026-10-08T12:00:00Z');
  const open = { status: 'OPEN', outstandingAmount: '40.00', dueDate: '2026-10-07' };

  it('derives overdue from dates while allowing payment of overdue and partly paid debt', () => {
    expect(isFinancialDocumentOverdue(open, asOf)).toBe(true);
    expect(isFinancialDocumentOverdue({ ...open, dueDate: '2026-10-08' }, asOf)).toBe(false);
    expect(isFinancialDocumentOverdue({ ...open, status: 'WRITTEN_OFF' }, asOf)).toBe(false);
    expect(
      canSettleFinancialDocument({ ...open, status: 'OVERDUE', lifecycleStatus: 'PARTIALLY_PAID' }),
    ).toBe(true);
    expect(canSettleFinancialDocument({ ...open, outstandingAmount: 0 })).toBe(false);
    expect(financialDocumentStatus({ ...open, status: 'OVERDUE', dueDate: '2099-01-01' })).toBe(
      'OPEN',
    );
    expect(
      financialDocumentStatus({
        ...open,
        status: 'PARTIALLY_PAID',
        lifecycleStatus: 'OVERDUE',
        dueDate: null,
      }),
    ).toBe('PARTIALLY_PAID');
    expect(
      financialDocumentStatus({
        ...open,
        status: 'OVERDUE',
        paidAmount: 10,
        dueDate: '2099-01-01',
      }),
    ).toBe('PARTIALLY_PAID');
  });

  it('uses calendar aging for a deadline late yesterday and does not age today', () => {
    expect(financialAgingBucket('2026-10-07T23:59:00Z', asOf)).toBe('1-30 days');
    expect(financialAgingBucket('2026-10-08', asOf)).toBe('Current');
    expect(financialAgingBucket('invalid', asOf)).toBe('—');
  });

  it('keeps delete governed by the server and distinguishes non-cash settlement', () => {
    expect(canDeleteFinancialDocument(open)).toBe(false);
    expect(canDeleteFinancialDocument({ ...open, canDelete: false })).toBe(false);
    expect(canDeleteFinancialDocument({ ...open, canDelete: true })).toBe(true);
    expect(settlementLabel({ paymentStatus: 'UNPAID', settlementStatus: 'WRITTEN_OFF' })).toBe(
      'WRITTEN_OFF',
    );
    expect(accountingCoverageLabel('CONFLICT')).toBe('Requires account review');
  });

  it('retains cents and denominations when a summary includes TZS and USD', () => {
    expect(
      formatFinancialTotals([
        { currency: 'TZS', amount: '49150000.10' },
        { currency: 'USD', amount: '100.10' },
        { currency: 'USD', amount: '0.20' },
      ]),
    ).toBe('TZS 49,150,000.10 · USD 100.30');
    expect(() => formatFinancialTotals([{ currency: 'USD', amount: 'not money' }])).toThrow();
  });
});
