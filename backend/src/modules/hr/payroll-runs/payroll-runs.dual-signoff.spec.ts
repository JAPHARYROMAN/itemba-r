import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  const advanceRow = {
    id: 'advance-1',
    amount: new Prisma.Decimal('1.00'),
    recoveredAmount: new Prisma.Decimal('0.00'),
  };

  const tx = {
    $queryRaw: jest.fn().mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('salary_advances')) return [advanceRow];
      return [row];
    }),
    payrollRun: {
      findUnique: jest.fn().mockResolvedValue(row),
      findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(row, data);
        return { ...row };
      }),
    },
    payrollEntryDeduction: {
      findMany: jest.fn().mockResolvedValue([
        { salaryAdvanceId: 'advance-1', amount: new Prisma.Decimal('0.10') },
        { salaryAdvanceId: 'advance-1', amount: new Prisma.Decimal('0.20') },
      ]),
    },
    salaryAdvance: {
      update: jest.fn().mockResolvedValue(undefined),
    },
    payrollEntryAllowance: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const prisma: any = {
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const postings: any = {
    postRun: jest.fn().mockImplementation(async (id: string) => postedRuns.push(id)),
    reverseAccrual: jest.fn().mockResolvedValue(null),
    postPayment: jest.fn().mockResolvedValue(null),
  };
  const service = new PayrollRunsService(prisma, audit, {} as any, postings, {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any);

  return { service, row, postedRuns, postings, tx, audit };
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

  it('reverses accrual postings before cancelling an approved run', async () => {
    const { service, row, postings } = makeServiceWithRun({
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
    expect(row.status).toBe('CANCELLED');
    expect(result?.status).toBe('CANCELLED');
  });

  it('treats repeat payroll pay calls as idempotent no-ops', async () => {
    const { service, postings, audit } = makeServiceWithRun({ status: 'PAID' });

    const result = await service.pay('run-1', user('pay-user'));

    expect(result.status).toBe('PAID');
    expect(postings.postPayment).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('uses Decimal arithmetic when syncing salary advance recoveries', async () => {
    const { service, tx } = makeServiceWithRun({ status: 'APPROVED' });

    await service.pay('run-1', user('pay-user'));

    const updateCall = tx.salaryAdvance.update.mock.calls[0][0];
    expect(Number(updateCall.data.recoveredAmount)).toBe(0.3);
    expect(updateCall.data.status).toBe('DEDUCTING');
  });
});
