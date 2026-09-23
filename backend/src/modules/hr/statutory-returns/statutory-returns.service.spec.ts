import { AccessLevel } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { StatutoryReturnsService } from './statutory-returns.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyScopeService } from '../../../common/services';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

describe('Statutory report read contracts', () => {
  const user = { id: 'user', companyId: 'company' } as AuthUser;
  const filter = { companyId: 'company', year: 2026, month: 9 };
  let prisma: { company: { findUnique: jest.Mock }; payrollStatutoryLine: { findMany: jest.Mock } };
  let scope: { assertCanAccessCompany: jest.Mock };
  let service: StatutoryReturnsService;
  beforeEach(() => {
    prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company',
          name: 'Example Company',
          profile: { tin: 'EMPLOYER-TIN' },
        }),
      },
      payrollStatutoryLine: { findMany: jest.fn().mockResolvedValue([]) },
    };
    scope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
    service = new StatutoryReturnsService(
      prisma as unknown as PrismaService,
      scope as unknown as CompanyScopeService,
    );
  });
  it.each([
    'payeReturn',
    'nssfReturn',
    'psssfReturn',
    'wcfReturn',
    'sdlReturn',
    'nhifReturn',
    'heslbReturn',
  ] as const)('%s denies company access before company or employee data reads', async (method) => {
    scope.assertCanAccessCompany.mockRejectedValue(new ForbiddenException('Company unavailable'));
    await expect(service[method](user, filter)).rejects.toThrow(ForbiddenException);
    expect(scope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company', AccessLevel.READ);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
    expect(prisma.payrollStatutoryLine.findMany).not.toHaveBeenCalled();
  });
  it.each([
    { year: NaN },
    { year: 2026.5 },
    { year: 1999 },
    { year: 2101 },
    { month: NaN },
    { month: 0 },
    { month: 13 },
    { month: 1.5 },
  ])('rejects invalid period %j before any query', async (invalid) => {
    await expect(service.payeReturn(user, { ...filter, ...invalid })).rejects.toThrow();
    expect(scope.assertCanAccessCompany).not.toHaveBeenCalled();
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });
  it('keeps selected-company, undeleted-entry and calendar period boundaries on the data query', async () => {
    const result = await service.payeReturn(user, filter);
    expect(prisma.payrollStatutoryLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taxType: { taxTypeCode: { in: ['PAYE_MAINLAND', 'PAYE_ZANZIBAR'] } },
          payrollEntry: {
            deletedAt: null,
            companyId: 'company',
            payrollRun: {
              payrollPeriod: {
                OR: [
                  {
                    paymentDate: {
                      gte: new Date('2026-09-01T00:00:00Z'),
                      lt: new Date('2026-10-01T00:00:00Z'),
                    },
                  },
                  {
                    AND: [
                      { paymentDate: null },
                      {
                        startDate: {
                          gte: new Date('2026-09-01T00:00:00Z'),
                          lt: new Date('2026-10-01T00:00:00Z'),
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      }),
    );
    expect(result.rows).toEqual([]);
    expect(result.summary).toEqual({ employees: 0, totalTaxable: 0, totalPaye: 0 });
    expect(result.header.periodLabel).toBe('September 2026');
  });
  it('retains complete PAYE aggregates and CSV escaping for repeated employee lines', async () => {
    const employee = {
      id: 'employee',
      employeeCode: 'EMP-EXAMPLE',
      fullName: 'Example, Alex',
      tin: 'TIN-EXAMPLE',
      nidaNumber: 'NIDA-EXAMPLE',
    };
    prisma.payrollStatutoryLine.findMany.mockResolvedValue([
      { basisAmount: 1000000, employeeContribution: 100000, payrollEntry: { employee } },
      { basisAmount: 500000, employeeContribution: 50000, payrollEntry: { employee } },
    ]);
    const result = await service.payeReturn(user, filter);
    expect(result.rows).toHaveLength(1);
    expect(result.summary).toEqual({ employees: 1, totalTaxable: 1500000, totalPaye: 150000 });
    expect(result.file.rowCount).toBe(1);
    expect(result.file.content).toContain('"Example, Alex"');
    expect(result.file.content).toContain('1500000.00,150000.00');
    expect(result.rows[0]).toMatchObject({ tin: 'TIN-EXAMPLE', nidaNumber: 'NIDA-EXAMPLE' });
  });
});
