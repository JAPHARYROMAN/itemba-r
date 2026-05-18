import { BadRequestException } from '@nestjs/common';
import { PayrollRunsService } from './payroll-runs.service';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

function user(id: string, overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id,
    email: `${id}@example.com`,
    roles: [],
    roleScopes: ['COMPANY'],
    permissions: [],
    companyId: 'company-1',
    companyAccess: [],
    ...overrides,
  };
}

interface RunRow {
  id: string;
  companyId: string;
  status: string;
  journalEntryId: string | null;
  hrApprovedById: string | null;
  hrApprovedAt: Date | null;
  financeApprovedById: string | null;
  financeApprovedAt: Date | null;
  approvedById: string | null;
  approvedAt: Date | null;
}

function makeServiceWithRun(initial: Partial<RunRow> = {}) {
  const row: RunRow = {
    id: 'run-1',
    companyId: 'company-1',
    status: 'SUBMITTED',
    journalEntryId: null,
    hrApprovedById: null,
    hrApprovedAt: null,
    financeApprovedById: null,
    financeApprovedAt: null,
    approvedById: null,
    approvedAt: null,
    ...initial,
  };
  const postedRuns: string[] = [];

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([row]),
    payrollRun: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(row, data);
        return { ...row };
      }),
    },
  };

  const prisma: any = {
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const postings: any = {
    postRun: jest.fn().mockImplementation(async (id: string) => postedRuns.push(id)),
    reverseAccrual: jest.fn().mockResolvedValue(null),
  };
  const labourCost: any = { reverseForRun: jest.fn().mockResolvedValue({ reversed: 0 }) };
  const service = new PayrollRunsService(prisma, audit, {} as any, postings, labourCost, {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any);

  return { service, row, postedRuns, postings, labourCost };
}

describe('PayrollRunsService dual sign-off', () => {
  it('records HR sign-off without finalizing when Finance is empty', async () => {
    const { service, row, postedRuns } = makeServiceWithRun();

    const result = await service.approveHr('run-1', user('hr-user'));

    expect(row.hrApprovedById).toBe('hr-user');
    expect(row.status).toBe('SUBMITTED');
    expect(row.approvedById).toBeNull();
    expect(postedRuns).toHaveLength(0);
    expect(result.status).toBe('SUBMITTED');
  });

  it('records Finance sign-off and finalizes after HR has signed', async () => {
    const { service, row, postedRuns } = makeServiceWithRun({
      hrApprovedById: 'hr-user',
      hrApprovedAt: new Date(),
    });

    const result = await service.approveFinance('run-1', user('finance-user'));

    expect(row.financeApprovedById).toBe('finance-user');
    expect(row.status).toBe('APPROVED');
    expect(row.approvedById).toBe('finance-user');
    expect(postedRuns).toEqual(['run-1']);
    expect(result.status).toBe('APPROVED');
  });

  it('prevents the same user from signing both HR and Finance', async () => {
    const { service, row } = makeServiceWithRun({
      hrApprovedById: 'shared-user',
      hrApprovedAt: new Date(),
    });

    await expect(service.approveFinance('run-1', user('shared-user'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(row.financeApprovedById).toBeNull();
  });

  it('keeps legacy approve blocked until both signatures exist', async () => {
    const { service, postedRuns } = makeServiceWithRun();

    await expect(service.approve('run-1', user('admin-user'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(postedRuns).toHaveLength(0);
  });

  it('reverses accrual postings and labour allocations before cancelling an approved run', async () => {
    const { service, row, postings, labourCost } = makeServiceWithRun({
      status: 'APPROVED',
      journalEntryId: 'je-1',
      hrApprovedById: 'hr-user',
      financeApprovedById: 'finance-user',
    });

    const result = await service.cancel('run-1', 'wrong period', user('admin-user'));

    expect(postings.reverseAccrual).toHaveBeenCalledWith(
      'run-1',
      'admin-user',
      'wrong period',
      expect.any(Object),
    );
    expect(labourCost.reverseForRun).toHaveBeenCalledWith('run-1', expect.any(Object));
    expect(row.status).toBe('CANCELLED');
    expect(result?.status).toBe('CANCELLED');
  });
});
