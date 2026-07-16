import { describe, expect, it } from 'vitest';
import { buildRecordBookPdfRequest } from './record-book-export';

describe('buildRecordBookPdfRequest', () => {
  it('turns receipt-level sales rows into one structured row per daily sale', () => {
    const rows = [
      {
        recordDate: '2026-07-11',
        company: 'WESTSIDES COMPANY LTD',
        division: 'HARDWARE AND BUILDING MATERIALS',
        branch: 'Kisimani Main Branch',
        currency: 'TZS',
        status: 'FINALIZED',
        totalSalesAmount: 11_207_000,
        receiptType: 'CASH',
        receiptAmount: 10_100_000,
      },
      {
        recordDate: '2026-07-11',
        company: 'WESTSIDES COMPANY LTD',
        division: 'HARDWARE AND BUILDING MATERIALS',
        branch: 'Kisimani Main Branch',
        currency: 'TZS',
        status: 'FINALIZED',
        totalSalesAmount: 11_207_000,
        receiptType: 'LIPA_NAMBA',
        receiptAmount: 1_107_000,
      },
      {
        recordDate: '2026-07-10',
        company: 'WESTSIDES COMPANY LTD',
        division: 'HARDWARE AND BUILDING MATERIALS',
        branch: 'Kisimani Main Branch',
        currency: 'TZS',
        status: 'FINALIZED',
        totalSalesAmount: 11_600_000,
        receiptType: 'CASH',
        receiptAmount: 10_800_000,
      },
      {
        recordDate: '2026-07-10',
        company: 'WESTSIDES COMPANY LTD',
        division: 'HARDWARE AND BUILDING MATERIALS',
        branch: 'Kisimani Main Branch',
        currency: 'TZS',
        status: 'FINALIZED',
        totalSalesAmount: 11_600_000,
        receiptType: 'LIPA_NAMBA',
        receiptAmount: 792_500,
      },
      {
        recordDate: '2026-07-10',
        company: 'WESTSIDES COMPANY LTD',
        division: 'HARDWARE AND BUILDING MATERIALS',
        branch: 'Kisimani Main Branch',
        currency: 'TZS',
        status: 'FINALIZED',
        totalSalesAmount: 11_600_000,
        receiptType: 'OTHER',
        receiptAmount: 7_500,
      },
    ];

    const request = buildRecordBookPdfRequest('sales', rows, {
      companyId: 'company-1',
      companyName: 'WESTSIDES COMPANY LTD',
      divisionId: 'division-1',
      divisionName: 'HARDWARE AND BUILDING MATERIALS',
      branchId: 'branch-1',
      branchName: 'Kisimani Main Branch',
      dateFrom: '2026-07-10',
      dateTo: '2026-07-11',
      status: 'FINALIZED',
    });

    expect(request.orientation).toBe('portrait');
    expect(request.columns).toEqual([
      'Date',
      'Total Sales',
      'Cash',
      'M-Pesa',
      'Lipa Namba',
      'Bank',
      'Card / Other',
    ]);
    expect(request.rows).toHaveLength(2);
    expect(request.rows[0]).toEqual([
      '11/07/2026',
      '11,207,000.00',
      '10,100,000.00',
      '0.00',
      '1,107,000.00',
      '0.00',
      '0.00',
    ]);
    expect(request.summary).toContainEqual({
      label: 'Recorded Sales (TZS)',
      value: 'TZS 22,807,000.00',
    });
    expect(request.columns).not.toContain('recordDate');
    expect(request.columns).not.toContain('receiptType');
  });

  it('builds readable expense and combined movement registers', () => {
    const expense = {
      recordType: 'EXPENSE',
      recordDate: '2026-07-11',
      company: 'WESTSIDES COMPANY LTD',
      division: 'Hardware',
      branch: 'Kisimani',
      category: 'Labour',
      description: 'Loading stock',
      paidTo: 'Casual workers',
      currency: 'TZS',
      amount: 250_000,
      moneyOut: 250_000,
      paymentMethod: 'CASH',
      reference: 'RB-EXP-01',
      status: 'FINALIZED',
    };
    const saleReceipt = {
      recordType: 'SALE_RECEIPT',
      recordDate: '2026-07-11',
      branch: 'Kisimani',
      currency: 'TZS',
      receiptType: 'CASH',
      receiptLabel: 'Cash',
      moneyIn: 1_000_000,
      reference: 'CLOSE-01',
    };

    const expenseRequest = buildRecordBookPdfRequest('expenses', [expense], {});
    const combinedRequest = buildRecordBookPdfRequest('combined', [saleReceipt, expense], {});

    expect(expenseRequest.columns).toContain('Description');
    expect(expenseRequest.columns).toContain('Paid To');
    expect(expenseRequest.columns).not.toContain('notes');
    expect(combinedRequest.columns).toEqual([
      'Date',
      'Type',
      'Scope',
      'Description / Payee',
      'Method',
      'Money In',
      'Money Out',
      'Reference',
    ]);
    expect(combinedRequest.summary).toEqual(
      expect.arrayContaining([
        { label: 'Money In (TZS)', value: 'TZS 1,000,000.00' },
        { label: 'Money Out (TZS)', value: 'TZS 250,000.00' },
        { label: 'Net Movement (TZS)', value: 'TZS 750,000.00' },
      ]),
    );
  });
});
