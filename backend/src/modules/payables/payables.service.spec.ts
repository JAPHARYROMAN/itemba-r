import { BadRequestException } from '@nestjs/common';
import { PayablesService } from './payables.service';

const user = { id: 'user-1' } as any;

function lockedPayable(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    supplierId: 'supplier-1',
    supplierName: 'Acme',
    payableNumber: 'PAY-2026-000001',
    outstandingAmount: '500',
    paidAmount: '0',
    status: 'OPEN',
    ...overrides,
  };
}

function makeService(lockedRow: Record<string, unknown>) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([lockedRow]),
    payable: { update: jest.fn() },
  } as any;
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const postingEngine = { postLines: jest.fn() } as any;
  const service = new PayablesService(
    prisma,
    { log: jest.fn() } as any,
    companyScope,
    { resolve: jest.fn() } as any,
    postingEngine,
    { next: jest.fn() } as any,
  );
  return { service, tx, postingEngine };
}

describe('PayablesService.recordPayment status guard', () => {
  it('rejects a payment against a WRITTEN_OFF payable and posts no settlement journal', async () => {
    // writeOff() does not zero outstandingAmount, so the amount check alone would
    // let this through — the status guard is what blocks it.
    const { service, tx, postingEngine } = makeService(lockedPayable({ status: 'WRITTEN_OFF' }));

    await expect(
      service.recordPayment('pay-1', { amount: 100 } as any, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payable.update).not.toHaveBeenCalled();
    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });
});
