import { ForbiddenException } from '@nestjs/common';
import { WcfAuditService } from './wcf-audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyScopeService } from '../../../common/services';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
describe('WCF exposure read contract', () => {
  const filter = { companyId: 'company', year: 2026, fromMonth: 1, toMonth: 3 };
  const user = { id: 'user', companyId: 'company' } as AuthUser;
  let prisma: { company: { findUnique: jest.Mock }; payrollStatutoryLine: { findMany: jest.Mock } };
  let scope: { assertCanAccessCompany: jest.Mock };
  let service: WcfAuditService;
  beforeEach(() => {
    prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company',
          name: 'Example Company',
          profile: { tin: 'EXAMPLE' },
        }),
      },
      payrollStatutoryLine: { findMany: jest.fn().mockResolvedValue([]) },
    };
    scope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
    service = new WcfAuditService(
      prisma as unknown as PrismaService,
      scope as unknown as CompanyScopeService,
    );
  });
  it.each([
    { companyId: '' },
    { year: NaN },
    { year: 2026.5 },
    { year: 1999 },
    { year: 2101 },
    { fromMonth: NaN },
    { fromMonth: 0 },
    { toMonth: 13 },
    { toMonth: 1.5 },
    { fromMonth: 4 },
  ])('rejects invalid filters %j before reads', async (invalid) => {
    await expect(service.exposureRegister({ ...filter, ...invalid }, user)).rejects.toThrow();
    expect(scope.assertCanAccessCompany).not.toHaveBeenCalled();
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });
  it('rejects inaccessible companies before retrieving their payroll data', async () => {
    scope.assertCanAccessCompany.mockRejectedValue(new ForbiddenException());
    await expect(service.exposureRegister(filter, user)).rejects.toThrow(ForbiddenException);
    expect(scope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company');
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
    expect(prisma.payrollStatutoryLine.findMany).not.toHaveBeenCalled();
  });
  it('preserves calendar boundaries, branch sums and distinct employees including unassigned records', async () => {
    const branch = { id: 'branch', name: 'Central', code: 'CENTRAL', location: 'Example region' };
    const line = (
      employeeId: string,
      date: string,
      gross: number,
      wcf: number,
      assigned = true,
      payment = true,
    ) => ({
      basisAmount: gross,
      employerContribution: wcf,
      payrollEntry: {
        employee: { id: employeeId, branch: assigned ? branch : null },
        payrollRun: {
          payrollPeriod: {
            paymentDate: payment ? new Date(date) : null,
            startDate: new Date(date),
          },
        },
      },
    });
    prisma.payrollStatutoryLine.findMany.mockResolvedValue([
      line('a', '2026-01-31', 1000000, 5000),
      line('a', '2026-01-31', 500000, 2500),
      line('b', '2026-01-31', 1000000, 5000),
      line('a', '2026-03-01', 2000000, 10000, true, false),
      line('c', '2026-03-31', 1000000, 5000, false),
    ]);
    const result = await service.exposureRegister(filter, user);
    const where = prisma.payrollStatutoryLine.findMany.mock.calls[0][0].where;
    expect(where.payrollEntry).toMatchObject({ companyId: 'company', deletedAt: null });
    expect(where.payrollEntry.payrollRun.payrollPeriod.OR).toEqual([
      { paymentDate: { gte: new Date('2026-01-01'), lt: new Date('2026-04-01') } },
      {
        AND: [
          { paymentDate: null },
          { startDate: { gte: new Date('2026-01-01'), lt: new Date('2026-04-01') } },
        ],
      },
    ]);
    expect(result.summary).toEqual({
      branchCount: 2,
      totalGross: 5500000,
      totalWcf: 27500,
      effectiveRate: 0.005,
    });
    expect(result.branches[0]).toMatchObject({
      branchId: 'branch',
      region: 'Example region',
      totalEmployees: 2,
      totalGross: 4500000,
      totalWcf: 22500,
      monthlyExposure: [
        { month: 1, gross: 2500000, wcfAmount: 12500, employees: 2 },
        { month: 3, gross: 2000000, wcfAmount: 10000, employees: 1 },
      ],
    });
    expect(result.branches[1]).toMatchObject({
      branchId: null,
      branchName: 'Unassigned (no branch)',
      totalEmployees: 1,
    });
  });
});
