import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../../common/services';
import { PrismaService } from '../../../prisma/prisma.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

@Injectable()
export class HrDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getDashboard(user: AuthUser, companyId?: string) {
    const companyWhere = (await this.companyScope.companyWhereFor(user, companyId)) as any;
    const filter: any = { ...companyWhere, deletedAt: null };
    const todayStart = startOfDay(new Date());
    const tomorrowStart = addDays(todayStart, 1);
    const in30Days = addDays(todayStart, 30);
    const monthStart = startOfMonth(todayStart);

    const [
      totalEmployees,
      activeEmployees,
      onLeaveEmployees,
      suspendedEmployees,
      totalActiveContracts,
      expiringContracts,
      pendingLeaveRequests,
      approvedLeaveRequests,
      openPayrollPeriods,
      payrollRunsInFlight,
      payrollRunsPaidThisMonth,
      payrollTotalsThisMonth,
      presentToday,
      absentToday,
      lateToday,
      scheduledShiftsToday,
      totalHrDocuments,
      expiringMedicalExams,
      openDisputes,
      activeDisciplinaryActions,
      employeesByCompany,
      employmentStatusRows,
      contractStatusRows,
      leaveStatusRows,
      payrollRunStatusRows,
      recentEmployees,
      upcomingContractExpiries,
    ] = await Promise.all([
      this.prisma.employee.count({ where: filter }),
      this.prisma.employee.count({
        where: { ...(filter as any), employmentStatus: 'ACTIVE', deletedAt: null },
      }),
      this.prisma.employee.count({
        where: { ...(filter as any), employmentStatus: 'ON_LEAVE', deletedAt: null },
      }),
      this.prisma.employee.count({
        where: { ...(filter as any), employmentStatus: 'SUSPENDED', deletedAt: null },
      }),
      this.prisma.employmentContract.count({
        where: { ...(filter as any), status: 'ACTIVE', deletedAt: null },
      }),
      this.prisma.employmentContract.count({
        where: {
          ...(filter as any),
          status: 'ACTIVE',
          endDate: { gte: todayStart, lte: in30Days },
          deletedAt: null,
        },
      }),
      this.prisma.leaveRequest.count({
        where: { ...(filter as any), status: 'SUBMITTED', deletedAt: null },
      }),
      this.prisma.leaveRequest.count({
        where: { ...(filter as any), status: 'APPROVED', deletedAt: null },
      }),
      this.prisma.payrollPeriod.count({
        where: {
          ...(filter as any),
          status: { in: ['OPEN', 'PROCESSING'] },
          deletedAt: null,
        },
      }),
      this.prisma.payrollRun.count({
        where: {
          ...(filter as any),
          status: { in: ['DRAFT', 'CALCULATED', 'SUBMITTED', 'APPROVED'] },
          deletedAt: null,
        },
      }),
      this.prisma.payrollRun.count({
        where: { ...(filter as any), status: 'PAID', paidAt: { gte: monthStart }, deletedAt: null },
      }),
      this.prisma.payrollRun.aggregate({
        where: { ...(filter as any), status: 'PAID', paidAt: { gte: monthStart }, deletedAt: null },
        _sum: { totalGrossPay: true, totalDeductions: true, totalNetPay: true },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          ...(filter as any),
          attendanceDate: { gte: todayStart, lt: tomorrowStart },
          attendanceStatus: 'PRESENT',
          deletedAt: null,
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          ...(filter as any),
          attendanceDate: { gte: todayStart, lt: tomorrowStart },
          attendanceStatus: 'ABSENT',
          deletedAt: null,
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          ...(filter as any),
          attendanceDate: { gte: todayStart, lt: tomorrowStart },
          attendanceStatus: 'LATE',
          deletedAt: null,
        },
      }),
      this.prisma.shiftSchedule.count({
        where: {
          ...(filter as any),
          scheduleDate: { gte: todayStart, lt: tomorrowStart },
          status: 'SCHEDULED',
          deletedAt: null,
        },
      }),
      this.prisma.hRDocument.count({
        where: { ...(companyWhere as any) },
      }),
      this.prisma.medicalExamRecord.count({
        where: {
          ...(filter as any),
          expiresAt: { gte: todayStart, lte: in30Days },
          deletedAt: null,
        },
      }),
      this.prisma.employmentDispute.count({
        where: {
          ...(filter as any),
          status: { notIn: ['RESOLVED', 'DISMISSED'] },
          deletedAt: null,
        },
      }),
      this.prisma.disciplinaryAction.count({
        where: { ...(filter as any), status: 'ACTIVE', deletedAt: null },
      }),
      this.prisma.employee.groupBy({
        by: ['companyId'],
        where: { ...(filter as any), employmentStatus: 'ACTIVE', deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.employee.groupBy({
        by: ['employmentStatus'],
        where: filter,
        _count: { _all: true },
      }),
      this.prisma.employmentContract.groupBy({
        by: ['status'],
        where: { ...(filter as any), deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.leaveRequest.groupBy({
        by: ['status'],
        where: { ...(filter as any), deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.payrollRun.groupBy({
        by: ['status'],
        where: { ...(filter as any), deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.employee.findMany({
        where: filter,
        select: {
          id: true,
          employeeCode: true,
          fullName: true,
          employmentStatus: true,
          departmentId: true,
          positionId: true,
          hireDate: true,
          companyId: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.employmentContract.findMany({
        where: {
          ...(filter as any),
          status: 'ACTIVE',
          endDate: { gte: todayStart, lte: in30Days },
          deletedAt: null,
        },
        select: {
          id: true,
          contractCode: true,
          employeeId: true,
          contractType: true,
          endDate: true,
          status: true,
        },
        orderBy: { endDate: 'asc' },
        take: 8,
      }),
    ]);

    const companyIds = employeesByCompany.map((row) => row.companyId);
    const companies = await this.prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true, code: true },
    });
    const companyById = new Map(companies.map((company) => [company.id, company]));

    return {
      totalActiveEmployees: activeEmployees,
      activeContracts: totalActiveContracts,
      totalEmployees,
      activeEmployees,
      onLeaveEmployees,
      suspendedEmployees,
      pendingLeaveRequests,
      approvedLeaveRequests,
      openPayrollPeriods,
      workforce: {
        total: totalEmployees,
        active: activeEmployees,
        onLeave: onLeaveEmployees,
        suspended: suspendedEmployees,
        activeRate: percentage(activeEmployees, totalEmployees),
      },
      contracts: {
        active: totalActiveContracts,
        expiringWithin30Days: expiringContracts,
      },
      leave: {
        pendingApproval: pendingLeaveRequests,
        approved: approvedLeaveRequests,
      },
      payroll: {
        openPeriods: openPayrollPeriods,
        runsInFlight: payrollRunsInFlight,
        paidRunsThisMonth: payrollRunsPaidThisMonth,
        grossPayThisMonth: toNumber(payrollTotalsThisMonth._sum.totalGrossPay),
        deductionsThisMonth: toNumber(payrollTotalsThisMonth._sum.totalDeductions),
        netPayThisMonth: toNumber(payrollTotalsThisMonth._sum.totalNetPay),
      },
      attendance: {
        scheduledShiftsToday,
        presentToday,
        absentToday,
        lateToday,
        attendanceCaptureRate: percentage(
          presentToday + absentToday + lateToday,
          scheduledShiftsToday,
        ),
      },
      compliance: {
        totalHrDocuments,
        expiringMedicalExams,
        openDisputes,
        activeDisciplinaryActions,
      },
      employmentStatusBreakdown: countBy(employmentStatusRows as GroupCount[], 'employmentStatus'),
      contractStatusBreakdown: countBy(contractStatusRows as GroupCount[], 'status'),
      leaveStatusBreakdown: countBy(leaveStatusRows as GroupCount[], 'status'),
      payrollRunStatusBreakdown: countBy(payrollRunStatusRows as GroupCount[], 'status'),
      employeesByCompany: employeesByCompany.map((e) => {
        const company = companyById.get(e.companyId);
        return {
          companyId: e.companyId,
          company: company?.name ?? e.companyId,
          code: company?.code,
          count: e._count?._all ?? 0,
        };
      }),
      recentEmployees,
      upcomingContractExpiries,
    };
  }
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfMonth(date: Date) {
  const value = new Date(date);
  value.setDate(1);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function countBy(rows: GroupCount[], key: string, emptyLabel = 'UNKNOWN') {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key];
    const label =
      value === null || value === undefined || value === '' ? emptyLabel : String(value);
    acc[label] = row._count._all;
    return acc;
  }, {});
}
