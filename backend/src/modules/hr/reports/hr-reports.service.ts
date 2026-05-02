import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class HrReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async employeeReport(user: any, query: any) {
    const { page = 1, limit = 50, companyId, divisionId, departmentId, status, search } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (departmentId) where.departmentId = departmentId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where, skip, take: Number(limit), orderBy: { fullName: 'asc' },
        select: {
          id: true, employeeCode: true, fullName: true, email: true, phone: true,
          employmentType: true, hireDate: true,
          department: { select: { id: true, name: true } },
          position: { select: { id: true, title: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async attendanceReport(user: any, query: any) {
    const { companyId, divisionId, employeeId, dateFrom, dateTo, page = 1, limit = 50 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.employee = { divisionId };
    if (employeeId) where.employeeId = employeeId;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where, skip, take: Number(limit), orderBy: { attendanceDate: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);

    // Aggregate summary
    const totals = await this.prisma.attendanceRecord.aggregate({
      where,
      _sum: { totalHours: true, overtimeHours: true, lateMinutes: true },
      _count: { id: true },
    });

    return {
      data, total, page: Number(page), limit: Number(limit),
      summary: {
        totalRecords: totals._count.id,
        totalHours: totals._sum.totalHours ?? 0,
        totalOvertimeHours: totals._sum.overtimeHours ?? 0,
        totalLateMinutes: totals._sum.lateMinutes ?? 0,
      },
    };
  }

  async payrollReport(user: any, query: any) {
    const { companyId, payrollPeriodId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (payrollPeriodId) where.payrollPeriodId = payrollPeriodId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.payrollRun.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          payrollPeriod: { select: { id: true, name: true, startDate: true, endDate: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.payrollRun.count({ where }),
    ]);

    const totals = await this.prisma.payrollRun.aggregate({
      where,
      _sum: { totalGrossPay: true, totalDeductions: true, totalNetPay: true },
    });

    return {
      data, total, page: Number(page), limit: Number(limit),
      totals: {
        totalGrossPay: totals._sum?.totalGrossPay ?? 0,
        totalDeductions: totals._sum?.totalDeductions ?? 0,
        totalNetPay: totals._sum?.totalNetPay ?? 0,
      },
    };
  }

  async leaveReport(user: any, query: any) {
    const { companyId, divisionId, leaveTypeId, status, dateFrom, dateTo, page = 1, limit = 50 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.employee = { divisionId };
    if (leaveTypeId) where.leaveTypeId = leaveTypeId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.startDate = {};
      if (dateFrom) where.startDate.gte = new Date(dateFrom);
      if (dateTo) where.startDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where, skip, take: Number(limit), orderBy: { startDate: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          leaveType: { select: { id: true, name: true } },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    const statusSummary = await this.prisma.leaveRequest.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
      _sum: { totalDays: true },
    });

    return {
      data, total, page: Number(page), limit: Number(limit),
      summary: statusSummary.map((s) => ({
        status: s.status,
        count: s._count.id,
        totalDays: s._sum.totalDays ?? 0,
      })),
    };
  }
}
