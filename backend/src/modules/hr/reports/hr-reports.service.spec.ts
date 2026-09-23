import { HrReportsService } from './hr-reports.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  HrEmployeeReportQueryDto,
  HrPayrollReportQueryDto,
} from '../../../common/dto/resource-query.dto';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

const reportUser: AuthUser = {
  id: 'operator',
  email: 'example@example.invalid',
  roles: [],
  permissions: ['hr.reports.view'],
  roleScopes: ['COMPANY'],
  companyId: 'company',
  companyAccess: [{ companyId: 'extra', accessLevel: 'READ' }],
};
function reportsSetup() {
  const delegate = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(23),
    aggregate: jest.fn().mockResolvedValue({
      _sum: {
        totalGrossPay: 12000000,
        totalNetPay: 10800000,
        totalDeductions: 1200000,
        totalHours: 168,
        overtimeHours: 12,
        lateMinutes: 30,
      },
      _count: { id: 23 },
    }),
    groupBy: jest
      .fn()
      .mockResolvedValue([{ status: 'SUBMITTED', _count: { id: 12 }, _sum: { totalDays: 24 } }]),
  });
  const prisma = {
    employee: delegate(),
    attendanceRecord: delegate(),
    payrollRun: delegate(),
    leaveRequest: delegate(),
  };
  return { prisma, service: new HrReportsService(prisma as never) };
}
describe('People report workspace contracts', () => {
  it('selects and filters actual employmentStatus with scoped search, count and pagination', async () => {
    const { prisma, service } = reportsSetup();
    const query = plainToInstance(HrEmployeeReportQueryDto, {
      page: '2',
      limit: '20',
      status: 'INACTIVE',
      search: 'Alex',
      companyId: 'extra',
    });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    const result = await service.employeeReport(reportUser, query);
    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        where: {
          deletedAt: null,
          companyId: 'extra',
          employmentStatus: 'INACTIVE',
          OR: [
            { fullName: { contains: 'Alex', mode: 'insensitive' } },
            { employeeCode: { contains: 'Alex', mode: 'insensitive' } },
          ],
        },
        select: expect.objectContaining({ employeeCode: true, employmentStatus: true }),
      }),
    );
    expect(prisma.employee.count).toHaveBeenCalledWith({
      where: prisma.employee.findMany.mock.calls[0][0].where,
    });
    expect(result).toMatchObject({ total: 23, page: 2, limit: 20 });
  });
  it('preserves company scope on all four report paths and denies an inaccessible company', async () => {
    const { prisma, service } = reportsSetup();
    for (const method of [
      'employeeReport',
      'attendanceReport',
      'payrollReport',
      'leaveReport',
    ] as const) {
      await service[method](reportUser, {});
      await expect(service[method](reportUser, { companyId: 'foreign' })).rejects.toThrow();
    }
    for (const delegate of Object.values(prisma)) {
      expect(delegate.findMany).toHaveBeenCalledTimes(1);
      expect(delegate.findMany.mock.calls[0][0].where.companyId).toEqual({
        in: ['company', 'extra'],
      });
    }
  });
  it('retains period/status filters and whole-result payroll totals and returns counts of undeleted entries', async () => {
    const { prisma, service } = reportsSetup();
    const query = plainToInstance(HrPayrollReportQueryDto, {
      companyId: 'company',
      payrollPeriodId: 'period',
      status: 'CALCULATED',
      page: '2',
      limit: '20',
    });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    const result = await service.payrollReport(reportUser, query);
    const args = prisma.payrollRun.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: { companyId: 'company', payrollPeriodId: 'period', status: 'CALCULATED' },
      include: { _count: { select: { entries: { where: { deletedAt: null } } } } },
    });
    expect(prisma.payrollRun.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: args.where }),
    );
    expect(prisma.payrollRun.count).toHaveBeenCalledWith({ where: args.where });
    expect(result.totals).toEqual({
      totalGrossPay: 12000000,
      totalDeductions: 1200000,
      totalNetPay: 10800000,
    });
  });
  it('keeps leave start-date selection and status totals independent of the current page', async () => {
    const { prisma, service } = reportsSetup();
    const result = await service.leaveReport(reportUser, {
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30T23:59:59.999Z',
      status: 'SUBMITTED',
      page: 2,
      limit: 20,
    });
    const args = prisma.leaveRequest.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        status: 'SUBMITTED',
        startDate: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30T23:59:59.999Z') },
      },
    });
    expect(prisma.leaveRequest.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: args.where }),
    );
    expect(result.summary).toEqual([{ status: 'SUBMITTED', count: 12, totalDays: 24 }]);
  });
  it('rejects invalid or reversed dates before any attendance or leave query', async () => {
    const { prisma, service } = reportsSetup();
    for (const method of ['attendanceReport', 'leaveReport'] as const) {
      await expect(service[method](reportUser, { dateFrom: 'invalid' })).rejects.toThrow(
        'valid dates',
      );
      await expect(
        service[method](reportUser, { dateFrom: '2026-09-30', dateTo: '2026-09-01' }),
      ).rejects.toThrow('From date must');
    }
    expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.findMany).not.toHaveBeenCalled();
  });
});

describe('HrReportsService.attendanceReport', () => {
  it('filters every attendance query by the Prisma attendanceDate field', async () => {
    const attendanceRecord = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { totalHours: null, overtimeHours: null, lateMinutes: null },
        _count: { id: 0 },
      }),
    };
    const service = new HrReportsService({ attendanceRecord } as any);
    const user = {
      companyId: 'company-1',
      companyAccess: [],
      roleScopes: [],
    } as any;

    await service.attendanceReport(user, {
      dateFrom: '2026-08-01T00:00:00.000Z',
      dateTo: '2026-08-31T23:59:59.999Z',
    });

    const expectedWhere = {
      deletedAt: null,
      companyId: { in: ['company-1'] },
      attendanceDate: {
        gte: new Date('2026-08-01T00:00:00.000Z'),
        lte: new Date('2026-08-31T23:59:59.999Z'),
      },
    };
    expect(attendanceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(attendanceRecord.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(attendanceRecord.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(expectedWhere).not.toHaveProperty('date');
  });
});
