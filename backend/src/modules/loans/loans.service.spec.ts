import { Prisma } from '@prisma/client';
import { LoansService } from './loans.service';
const user = { id: 'user' } as any;
function harness() {
  const loan = {
    id: 'loan',
    companyId: 'co',
    divisionId: null,
    branchId: null,
    principalAmount: new Prisma.Decimal(100),
    outstandingBalance: new Prisma.Decimal(80),
    status: 'ACTIVE',
    disbursementDate: new Date('2026-01-01'),
  };
  const tx: any = {
    $queryRaw: jest.fn(),
    loan: {
      findFirst: jest.fn().mockResolvedValue(loan),
      update: jest.fn(async ({ data }) => ({ ...loan, ...data })),
    },
    loanFinancialEvent: { count: jest.fn().mockResolvedValue(1) },
    loanRepayment: { count: jest.fn().mockResolvedValue(0) },
    loanRepaymentSchedule: { count: jest.fn().mockResolvedValue(0) },
  };
  const db: any = { $transaction: jest.fn((fn) => fn(tx)), loan: tx.loan };
  const audit: any = { logStrictInTransaction: jest.fn(), log: jest.fn() };
  const scope: any = { assertCanAccessCompany: jest.fn() };
  const lifecycle: any = { create: jest.fn().mockResolvedValue(loan), repay: jest.fn() };
  const ledger: any = { scope: jest.fn() };
  const service = new LoansService(
    db,
    audit,
    scope,
    {} as any,
    {} as any,
    {} as any,
    lifecycle,
    ledger,
  );
  return { service, tx, loan, audit, lifecycle, ledger };
}
describe('Loan register financial protections', () => {
  it('includes scheduled payments in the detail and print history without duplicating direct payments', async () => {
    const { service, tx, loan } = harness();
    const direct = {
      id: 'direct',
      repaymentDate: new Date('2026-01-02'),
      createdAt: new Date('2026-01-02'),
    };
    const scheduled = {
      id: 'scheduled',
      paymentDate: new Date('2026-01-03'),
      createdAt: new Date('2026-01-03'),
      amount: new Prisma.Decimal(20),
      currency: 'TZS',
      paymentMethod: 'BANK_TRANSFER',
      reference: 'partial',
      paidById: 'user',
      paidBy: { fullName: 'Test operator' },
      deletedAt: null,
    };
    const event = {
      principal: new Prisma.Decimal(17),
      interest: new Prisma.Decimal(2),
      fees: new Prisma.Decimal(1),
      penalties: new Prisma.Decimal(0),
      reversedAt: new Date('2026-01-04'),
      scheduledPayment: scheduled,
    };
    tx.loan.findFirst.mockResolvedValue({
      ...loan,
      repayments: [direct],
      financialEvents: [event],
    });
    const result = await service.findOne('loan', user);
    expect(result.repayments.map((payment) => payment.id)).toEqual(['scheduled', 'direct']);
    expect(result.repayments[0]).toMatchObject({
      repaymentDate: scheduled.paymentDate,
      referenceNumber: 'partial',
      principal: event.principal,
      interest: event.interest,
      user: { fullName: 'Test operator' },
      financialEvent: { fees: event.fees, reversedAt: event.reversedAt },
    });
    expect(result).not.toHaveProperty('financialEvents');
  });
  it('keeps repayment details inaccessible when the organisation check denies access', async () => {
    const { service, ledger, audit } = harness();
    ledger.scope.mockRejectedValue(new Error('Company access denied'));
    await expect(service.findOne('loan', user)).rejects.toThrow('Company access denied');
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('uses the shared atomic lifecycle for recognition and payments', async () => {
    const { service, lifecycle } = harness();
    const dto = {} as any;
    await service.create(dto, user);
    await service.recordRepayment('loan', dto, user);
    expect(lifecycle.create).toHaveBeenCalledWith(dto, user);
    expect(lifecycle.repay).toHaveBeenCalledWith('loan', dto, user);
  });
  it('locks before editing, checks organisation and never writes a supplied balance', async () => {
    const { service, tx, ledger } = harness();
    await service.update('loan', { notes: 'Reviewed', outstandingBalance: '80' }, user);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(ledger.scope).toHaveBeenCalled();
    expect(tx.loan.update).toHaveBeenCalledWith({
      where: { id: 'loan' },
      data: { notes: 'Reviewed' },
    });
  });
  it('rejects a stale financial edit without changing any fields', async () => {
    const { service, tx } = harness();
    await expect(
      service.update('loan', { outstandingBalance: '100', notes: 'stale' }, user),
    ).rejects.toThrow('balances cannot');
    expect(tx.loan.update).not.toHaveBeenCalled();
  });
  it('prevents manual settlement and reopening closed loans', async () => {
    const { service, tx, loan } = harness();
    await expect(service.markStatus('loan', { status: 'FULLY_PAID' } as any, user)).rejects.toThrow(
      'controlled',
    );
    loan.status = 'FULLY_PAID';
    await expect(service.markStatus('loan', { status: 'ACTIVE' } as any, user)).rejects.toThrow(
      'closed loan',
    );
    expect(tx.loan.update).not.toHaveBeenCalled();
  });
  it('preserves loans with financial history', async () => {
    const { service, tx } = harness();
    await expect(service.remove('loan', user)).rejects.toThrow('history');
    expect(tx.loan.update).not.toHaveBeenCalled();
  });
  it('does not change scheduled terms', async () => {
    const { service, tx } = harness();
    tx.loanRepaymentSchedule.count.mockResolvedValue(1);
    await expect(service.update('loan', { interestRate: '0.2' }, user)).rejects.toThrow(
      'restructuring',
    );
    expect(tx.loan.update).not.toHaveBeenCalled();
  });
});
