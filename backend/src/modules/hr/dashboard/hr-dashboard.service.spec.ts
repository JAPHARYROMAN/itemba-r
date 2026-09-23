import { HrDashboardService } from './hr-dashboard.service';

function makePrisma() {
  return {
    employee: {
      count: jest
        .fn()
        .mockResolvedValueOnce(25)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ companyId: 'company-1', _count: { _all: 20 } }])
        .mockResolvedValueOnce([{ employmentStatus: 'ACTIVE', _count: { _all: 20 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'employee-1', fullName: 'Employee 1' }]),
    },
    employmentContract: {
      count: jest.fn().mockResolvedValueOnce(18).mockResolvedValueOnce(4),
      groupBy: jest.fn().mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 18 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'contract-1' }]),
    },
    leaveRequest: {
      count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(7),
      groupBy: jest.fn().mockResolvedValue([{ status: 'SUBMITTED', _count: { _all: 5 } }]),
    },
    payrollPeriod: { count: jest.fn().mockResolvedValue(2) },
    payrollRun: {
      count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalGrossPay: 1000000, totalDeductions: 200000, totalNetPay: 800000 },
      }),
      groupBy: jest.fn().mockResolvedValue([{ status: 'PAID', _count: { _all: 1 } }]),
    },
    attendanceRecord: {
      count: jest.fn().mockResolvedValueOnce(16).mockResolvedValueOnce(2).mockResolvedValueOnce(1),
    },
    shiftSchedule: { count: jest.fn().mockResolvedValue(20) },
    hRDocument: { count: jest.fn().mockResolvedValue(14) },
    medicalExamRecord: { count: jest.fn().mockResolvedValue(6) },
    employmentDispute: { count: jest.fn().mockResolvedValue(2) },
    disciplinaryAction: { count: jest.fn().mockResolvedValue(1) },
    company: {
      findMany: jest.fn().mockResolvedValue([{ id: 'company-1', name: 'Company 1', code: 'C1' }]),
    },
  } as any;
}

describe('HrDashboardService dashboard summary', () => {
  it('returns scoped workforce, payroll, attendance, and HR compliance metrics', async () => {
    const prisma = makePrisma();
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    };
    const service = new HrDashboardService(prisma, companyScope as any);

    const result = await service.getDashboard({ id: 'user-1' } as any, 'company-1');

    expect(result.totalActiveEmployees).toBe(20);
    expect(result.workforce).toEqual({
      total: 25,
      active: 20,
      onLeave: 3,
      suspended: 2,
      activeRate: 80,
    });
    expect(result.payroll.netPayThisMonth).toBe(800000);
    expect(result.attendance.attendanceCaptureRate).toBe(95);
    expect(result.compliance).toEqual({
      totalHrDocuments: 14,
      expiringMedicalExams: 6,
      openDisputes: 2,
      activeDisciplinaryActions: 1,
    });
    expect(result.employeesByCompany).toEqual([
      { companyId: 'company-1', company: 'Company 1', code: 'C1', count: 20 },
    ]);
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith({ id: 'user-1' }, 'company-1');
    expect(prisma.employmentDispute.count).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        deletedAt: null,
        status: { notIn: ['RESOLVED', 'DISMISSED', 'WITHDRAWN'] },
      },
    });
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
    expect(prisma.employmentContract.findMany).not.toHaveBeenCalled();
    expect(result.recentEmployees).toEqual([]);
    expect(result.upcomingContractExpiries).toEqual([]);
  });
  it('scopes permitted employee/contract previews and every aggregate before querying', async () => {
    const prisma = makePrisma();
    const scope = {
      companyWhereFor: jest
        .fn()
        .mockResolvedValue({ companyId: { in: ['company-1', 'company-2'] } }),
    };
    const service = new HrDashboardService(prisma, scope as any);
    const result = await service.getDashboard({
      id: 'user',
      permissions: ['employees.view', 'employment_contracts.view'],
    } as any);
    expect(result.recentEmployees).toEqual([{ id: 'employee-1', fullName: 'Employee 1' }]);
    expect(result.upcomingContractExpiries).toEqual([{ id: 'contract-1' }]);
    for (const [name, model] of Object.entries(prisma) as Array<
      [string, Record<string, jest.Mock>]
    >) {
      if (name === 'company') continue;
      for (const fn of Object.values(model))
        for (const [args] of fn.mock.calls)
          expect(args.where).toMatchObject({ companyId: { in: ['company-1', 'company-2'] } });
    }
    expect(prisma.employee.findMany.mock.calls[0][0]).toMatchObject({
      take: 8,
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.employmentContract.findMany.mock.calls[0][0]).toMatchObject({
      take: 8,
      where: { status: 'ACTIVE', deletedAt: null },
      orderBy: { endDate: 'asc' },
    });
  });
  it('denies an inaccessible company before any aggregate or preview query', async () => {
    const prisma = makePrisma();
    const service = new HrDashboardService(prisma, {
      companyWhereFor: jest.fn().mockRejectedValue(new Error('Company access denied')),
    } as any);
    await expect(
      service.getDashboard({ id: 'user', permissions: [] } as any, 'foreign'),
    ).rejects.toThrow('Company access denied');
    for (const model of Object.values(prisma) as Array<Record<string, jest.Mock>>)
      for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
  });
});
