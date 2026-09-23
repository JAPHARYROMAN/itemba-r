import { Prisma } from '@prisma/client';
import { financingReport, internalReport, FinancingLoan, InternalLoan } from './financing.domain';
import { FinancingReportsService } from './financing.service';
import { FinancingReportsController } from './financing.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
const D = (s: string) => new Prisma.Decimal(s),
  date = (s: string) => new Date(s),
  q = { from: '2025-09-01', to: '2025-09-30' };
const loan = (patch: Partial<FinancingLoan> = {}): FinancingLoan => ({
  id: 'loan',
  reference: 'L-1',
  lender: 'Bank',
  company: 'Company',
  currency: 'TZS',
  type: 'BANK_LOAN',
  status: 'ACTIVE',
  date: date('2025-01-01'),
  maturity: date('2026-01-01'),
  current: D('80'),
  payments: [
    {
      id: 'p',
      date: date('2025-09-10'),
      amount: D('12'),
      principal: D('10'),
      reference: 'R1',
      currency: 'TZS',
    },
    {
      id: 'later',
      date: date('2025-10-10'),
      amount: D('12'),
      principal: D('10'),
      reference: 'R2',
      currency: 'TZS',
    },
  ],
  installments: [
    {
      id: 'i',
      due: date('2025-10-10'),
      amount: D('12'),
      payments: [{ date: date('2025-10-10'), amount: D('12') }],
    },
  ],
  ...patch,
});
const internal = (patch: Partial<InternalLoan> = {}): InternalLoan => ({
  id: 'internal',
  currency: 'TZS',
  principal: D('100'),
  current: D('70'),
  date: date('2025-08-01'),
  due: date('2025-10-01'),
  description: 'Working capital',
  lenderId: 'a',
  borrowerId: 'b',
  lender: 'Company A',
  borrower: 'Company B',
  payments: [
    { id: 'p1', date: date('2025-09-05'), amount: D('20'), reference: 'R1' },
    { id: 'p2', date: date('2025-10-05'), amount: D('10'), reference: 'R2' },
  ],
  ...patch,
});
describe('Financing reports', () => {
  it('bridges principal back through later repayments and separates finance charges', () => {
    const r = financingReport([loan()], q);
    expect(r.currencies[0]).toMatchObject({
      principal: '90.00',
      due7: '0.00',
      due30: '12.00',
      due90: '12.00',
    });
    expect(r.tables.find((t) => t.id === 'repayments')!.rows).toEqual([
      expect.objectContaining({ principal: '10.00', charges: '2.00', amount: '12.00' }),
    ]);
  });
  it('does not count repayments twice in scheduled commitments or mix excluded registers', () => {
    const r = financingReport(
      [
        loan(),
        loan({ id: 'supplier', type: 'SUPPLIER_CREDIT' }),
        loan({ id: 'internal', type: 'INTER_COMPANY_LOAN' }),
      ],
      { from: '2025-10-01', to: '2025-10-31' },
    );
    expect(r.currencies[0].principal).toBe('80.00');
    expect(r.currencies[0].due90).toBe('0.00');
    expect(r.tables[0].rows).toHaveLength(3);
  });
  it('fails closed on missing historical allocations and flags missing schedules', () => {
    const r = financingReport(
      [
        loan({ payments: [{ ...loan().payments[1], principal: null }] }),
        loan({ id: 'unscheduled', payments: [], installments: [] }),
      ],
      q,
    );
    expect(r.currencies[0].principal).toBeNull();
    expect(r.tables.find((t) => t.id === 'issues')!.rows).toHaveLength(2);
  });
  it('preserves decimals and separates currencies', () => {
    const r = financingReport(
      [
        loan({ current: D('9007199254740993.11'), payments: [] }),
        loan({ id: 'usd', currency: 'USD', current: D('0.10'), payments: [] }),
      ],
      q,
    );
    expect(r.currencies.find((c) => c.currency === 'TZS')!.principal).toBe('9007199254740993.11');
    expect(r.currencies.find((c) => c.currency === 'USD')!.principal).toBe('0.10');
  });
  it('eliminates each internal principal once only when both accounts are selected', () => {
    expect(internalReport([internal()], new Set(['a', 'b']), q).currencies[0]).toEqual({
      currency: 'TZS',
      receivable: '0.00',
      payable: '0.00',
      eliminated: '80.00',
    });
    expect(internalReport([internal()], new Set(['a']), q).currencies[0]).toEqual({
      currency: 'TZS',
      receivable: '80.00',
      payable: '0.00',
      eliminated: '0.00',
    });
    expect(internalReport([internal()], new Set(['b']), q).currencies[0]).toEqual({
      currency: 'TZS',
      receivable: '0.00',
      payable: '80.00',
      eliminated: '0.00',
    });
  });
  it('flags a loan register that disagrees with unreversed repayments', () => {
    const r = internalReport([internal({ current: D('50') })], new Set(['a', 'b']), q);
    expect(r.tables[0].rows[0].check).toBe('Balance mismatch');
    expect(r.tables[1].rows).toHaveLength(1);
  });
});
describe('Financing report access', () => {
  const user = {
    id: 'u',
    email: 'u@test.local',
    permissions: [],
    roles: [],
    roleScopes: ['COMPANY'],
  } as AuthUser;
  const companies = { companyWhereFor: jest.fn(async () => ({ companyId: { in: ['allowed'] } })) },
    org = { recordWhereFor: jest.fn(async () => ({ branchId: { in: ['branch'] } })) };
  it('uses both source permissions for ERP loan schedules', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, FinancingReportsController.prototype.borrowings),
    ).toEqual(['loans.read', 'loan_schedules.list']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, FinancingReportsController.prototype.internal),
    ).toEqual(['cash_desk.view']);
  });
  it('keeps company and branch scope on borrowing reads', async () => {
    const findMany = jest.fn().mockResolvedValue([]),
      tx = {
        loan: { count: async () => 0, findMany },
        loanRepayment: { count: async () => 0 },
        loanRepaymentSchedule: { count: async () => 0, findMany: async () => [] },
        loanRepaymentPayment: { count: async () => 0 },
        journalEntry: { findMany: async () => [] },
      };
    const db = { $transaction: jest.fn(async (work) => work(tx)) };
    await new FinancingReportsService(
      db as never,
      companies as never,
      org as never,
      {} as never,
    ).borrowings(user, q);
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({
      AND: [
        { companyId: { in: ['allowed'] } },
        { branchId: { in: ['branch'] } },
        { divisionId: undefined, branchId: undefined },
      ],
    });
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
  });
  it('uses the posted principal line for scheduled repayments rather than charging the entire cash amount to principal', async () => {
    const sourceLoan = {
      id: 'loan',
      companyId: 'allowed',
      company: { name: 'Company' },
      group: null,
      loanReference: 'L1',
      lenderName: 'Bank',
      currency: 'TZS',
      obligationType: 'BANK_LOAN',
      status: 'ACTIVE',
      disbursementDate: date('2025-01-01'),
      maturityDate: date('2026-01-01'),
      outstandingBalance: D('80'),
      repayments: [],
    };
    const schedule = {
      id: 's',
      loanDebtId: 'loan',
      companyId: 'allowed',
      dueDate: date('2025-10-10'),
      totalAmount: D('12'),
      payments: [
        {
          id: 'p',
          journalEntryId: 'j',
          paymentDate: date('2025-10-10'),
          amount: D('12'),
          currency: 'TZS',
          reference: 'Paid',
          repaymentPaymentNumber: 'P1',
        },
      ],
    };
    const tx = {
      loan: { count: async () => 1, findMany: async () => [sourceLoan] },
      loanRepayment: { count: async () => 0 },
      loanRepaymentSchedule: { count: async () => 1, findMany: async () => [schedule] },
      loanRepaymentPayment: { count: async () => 1 },
      journalEntry: {
        findMany: async () => [
          {
            id: 'j',
            companyId: 'allowed',
            referenceId: 's',
            lines: [
              { accountId: 'principal', debit: D('10'), credit: D('0') },
              { accountId: 'interest', debit: D('2'), credit: D('0') },
              { accountId: 'cash', debit: D('0'), credit: D('12') },
            ],
          },
        ],
      },
    };
    const service = new FinancingReportsService(
      { $transaction: async (work: (db: typeof tx) => unknown) => work(tx) } as never,
      companies as never,
      org as never,
      { resolve: async () => ({ id: 'principal' }) } as never,
    );
    const report = await service.borrowings(user, q);
    expect(report.currencies[0].principal).toBe('90.00');
    expect(report.currencies[0].due30).toBe('12.00');
  });
  it('hides inaccessible counterparty identities and does not eliminate their side', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'l',
        currency: 'TZS',
        principal: D('100'),
        outstanding: D('100'),
        loanDate: date('2025-08-01'),
        dueDate: null,
        description: 'loan',
        lenderAccountId: 'a',
        borrowerAccountId: 'b',
        lender: { name: 'Bank A', company: { name: 'Allowed' } },
        borrower: { name: 'Secret account', company: { name: 'Secret company' } },
        movements: [],
      },
    ]);
    const tx = {
      cashDeskLoan: { count: async () => 1, findMany },
      cashDeskMovement: { count: async () => 0 },
      cashDeskAccount: { findMany: async () => [{ id: 'a' }] },
    };
    const r = await new FinancingReportsService(
      { $transaction: async (work: (db: typeof tx) => unknown) => work(tx) } as never,
      companies as never,
      org as never,
      {} as never,
    ).internal(user, q);
    expect(JSON.stringify(r)).not.toContain('Secret');
    expect(r.currencies[0].eliminated).toBe('0.00');
    expect(r.currencies[0].receivable).toBe('100.00');
    expect(findMany.mock.calls[0][0].where.OR[0].lender.AND).toContainEqual({
      branchId: { in: ['branch'] },
    });
  });
});
