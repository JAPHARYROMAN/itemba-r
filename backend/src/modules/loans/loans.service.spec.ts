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
  const db: any = { $transaction: jest.fn((fn) => fn(tx)) };
  const audit: any = { logStrictInTransaction: jest.fn() };
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
