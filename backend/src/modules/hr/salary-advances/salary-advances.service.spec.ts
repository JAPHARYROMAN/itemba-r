import { SalaryAdvancesService } from './salary-advances.service';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

function user(id: string): AuthUser {
  return {
    id,
    email: `${id}@example.com`,
    roles: [],
    roleScopes: ['COMPANY'],
    permissions: [],
    companyId: 'company-1',
    companyAccess: [],
  };
}

function makeService(status = 'PAID') {
  const row = { id: 'advance-1', companyId: 'company-1', status };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([row]),
    salaryAdvance: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...row, ...data })),
    },
  };
  const prisma: any = {
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const postings: any = { postAdvancePayment: jest.fn().mockResolvedValue(null) };
  const service = new SalaryAdvancesService(
    prisma,
    audit,
    postings,
    {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    } as any,
    { next: jest.fn().mockResolvedValue('ADV-2026-00001') } as any,
  );

  return { service, tx, audit, postings };
}

describe('SalaryAdvancesService pay idempotency', () => {
  it.each(['PAID', 'DEDUCTING', 'SETTLED'])(
    'returns existing %s advances without reposting payment',
    async (status) => {
      const { service, tx, audit, postings } = makeService(status);

      const result = await service.pay('advance-1', user('pay-user'));

      expect(result.status).toBe(status);
      expect(tx.salaryAdvance.update).not.toHaveBeenCalled();
      expect(postings.postAdvancePayment).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    },
  );

  it('locks, marks approved advances as paid, and posts once', async () => {
    const { service, tx, audit, postings } = makeService('APPROVED');

    const result = await service.pay('advance-1', user('pay-user'));

    expect(result.status).toBe('PAID');
    expect(tx.salaryAdvance.update).toHaveBeenCalledWith({
      where: { id: 'advance-1' },
      data: { status: 'PAID', paidAt: expect.any(Date), paidById: 'pay-user' },
    });
    expect(postings.postAdvancePayment).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});
