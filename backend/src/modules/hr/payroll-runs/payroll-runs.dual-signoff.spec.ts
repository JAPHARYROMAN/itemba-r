import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PayrollRunsService } from './payroll-runs.service';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

/**
 * Phase 3A — payroll dual sign-off regression.
 *
 * Pins the contract that:
 *   - approveHr stamps the HR side only and does NOT finalize when Finance side is still empty
 *   - approveFinance stamps Finance side and finalizes (posts JE) once HR side is already in
 *   - the same user cannot hold both signatures (maker-checker)
 *   - the legacy single-step approve() refuses to finalize unless BOTH sides are already signed
 *
 * The prisma client is mocked at the granularity these service methods touch.
 */

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
    hrApprovedById: null,
    hrApprovedAt: null,
    financeApprovedById: null,
    financeApprovedAt: null,
    approvedById: null,
    approvedAt: null,
    ...initial,
  };

  const postRunCalls: string[] = [];

  const tx = {
    $queryRaw: jest.fn().mockImplementation(async () => [row]),
    payrollRun: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(row, data);
        return { ...row };
      }),
    },
  };

  const prisma: any = {
    $transaction: jest.fn().mockImplementation(async (fn: any, _opts: any) => fn(tx)),
  };

  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const calculator: any = {};
  const postings: any = {
    postRun: jest.fn().mockImplementation(async (id: string) => {
      postRunCalls.push(id);
    }),
  };
  const labourCost: any = {};
  const companyScope: any = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({}),
  };

  const service = new PayrollRunsService(prisma, audit, calculator, postings, labourCost, companyScope);
  return { service, row, postings, audit, postRunCalls };
}

describe('PayrollRunsService — Phase 3A dual sign-off', () => {
  it('approveHr stamps HR side only when Finance is empty', async () => {
    const { service, row, postRunCalls } = makeServiceWithRun();

    const result = await service.approveHr('run-1', user('hr-user'));

    expect(row.hrApprovedById).toBe('hr-user');
    expect(row.hrApprovedAt).toBeInstanceOf(Date);
    expect(row.status).toBe('SUBMITTED'); // not finalized yet
    expect(row.approvedById).toBeNull();
    expect(postRunCalls).toHaveLength(0); // no JE posted yet
    expect(result.status).toBe('SUBMITTED');
  });

  it('approveFinance after approveHr finalizes the run and posts the JE', async () => {
    const { service, row, postRunCalls } = makeServiceWithRun({
      hrApprovedById: 'hr-user',
      hrApprovedAt: new Date(),
    });

    const result = await service.approveFinance('run-1', user('cfo-user'));

    expect(row.financeApprovedById).toBe('cfo-user');
    expect(row.status).toBe('APPROVED');
    expect(row.approvedById).toBe('cfo-user');
    expect(postRunCalls).toEqual(['run-1']); // JE posting was triggered
    expect(result.status).toBe('APPROVED');
  });

  it('maker-checker: same user cannot hold both signatures (HR then Finance)', async () => {
    const { service, row } = makeServiceWithRun({
      hrApprovedById: 'shared-user',
      hrApprovedAt: new Date(),
    });

    await expect(service.approveFinance('run-1', user('shared-user'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(row.financeApprovedById).toBeNull();
  });

  it('maker-checker: same user cannot hold both signatures (Finance then HR)', async () => {
    const { service, row } = makeServiceWithRun({
      financeApprovedById: 'shared-user',
      financeApprovedAt: new Date(),
    });

    await expect(service.approveHr('run-1', user('shared-user'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(row.hrApprovedById).toBeNull();
  });

  it('approveHr rejects if HR signature is already recorded', async () => {
    const { service } = makeServiceWithRun({
      hrApprovedById: 'previous-hr',
      hrApprovedAt: new Date(),
    });
    await expect(service.approveHr('run-1', user('another-hr'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('legacy approve() refuses to finalize when both signatures are missing', async () => {
    const { service, postRunCalls } = makeServiceWithRun();
    await expect(service.approve('run-1', user('admin'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(postRunCalls).toHaveLength(0);
  });

  it('legacy approve() finalizes when both signatures are already in place', async () => {
    const { service, row, postRunCalls } = makeServiceWithRun({
      hrApprovedById: 'hr-user',
      hrApprovedAt: new Date(),
      financeApprovedById: 'cfo-user',
      financeApprovedAt: new Date(),
    });
    await service.approve('run-1', user('admin'));
    expect(row.status).toBe('APPROVED');
    expect(postRunCalls).toEqual(['run-1']);
  });

  it('approveHr rejects if the run is not in SUBMITTED status', async () => {
    const { service } = makeServiceWithRun({ status: 'DRAFT' });
    await expect(service.approveHr('run-1', user('hr-user'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
