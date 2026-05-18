import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../../common/services';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';

export interface LeaveBalanceQuery {
  page?: string | number;
  limit?: string | number;
  companyId?: string;
  employeeId?: string;
  leaveTypeId?: string;
  year?: string | number;
}

export interface LeaveBalanceAllocationInput {
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  allocatedDays?: number;
  carriedForwardDays?: number;
  notes?: string;
}

@Injectable()
export class LeaveBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: LeaveBalanceQuery) {
    const { page = 1, limit = 20, companyId, employeeId, leaveTypeId, year } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: Prisma.LeaveBalanceWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (employeeId) where.employeeId = employeeId;
    if (leaveTypeId) where.leaveTypeId = leaveTypeId;
    if (year) where.year = Number(year);

    const [data, total] = await Promise.all([
      this.prisma.leaveBalance.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
        include: {
          company: { select: { id: true, name: true } },
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          leaveType: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.leaveBalance.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.leaveBalance.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true } },
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        leaveType: { select: { id: true, name: true, code: true } },
      },
    });
    if (!record) throw new NotFoundException('Leave balance not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  async upsertAllocation(body: LeaveBalanceAllocationInput, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, body.companyId, AccessLevel.WRITE);
    if (!body.employeeId || !body.leaveTypeId || !body.year) {
      throw new BadRequestException('companyId, employeeId, leaveTypeId and year are required');
    }

    const [employee, leaveType] = await Promise.all([
      this.prisma.employee.findFirst({
        where: { id: body.employeeId, companyId: body.companyId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.leaveType.findFirst({
        where: { id: body.leaveTypeId, companyId: body.companyId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!employee) throw new BadRequestException('Employee does not belong to this company');
    if (!leaveType) throw new BadRequestException('Leave type does not belong to this company');

    const record = await this.prisma.leaveBalance.upsert({
      where: {
        companyId_employeeId_leaveTypeId_year: {
          companyId: body.companyId,
          employeeId: body.employeeId,
          leaveTypeId: body.leaveTypeId,
          year: Number(body.year),
        },
      },
      create: {
        companyId: body.companyId,
        employeeId: body.employeeId,
        leaveTypeId: body.leaveTypeId,
        year: Number(body.year),
        allocatedDays: body.allocatedDays ?? 0,
        carriedForwardDays: body.carriedForwardDays ?? 0,
        notes: body.notes,
      },
      update: {
        allocatedDays: body.allocatedDays,
        carriedForwardDays: body.carriedForwardDays,
        notes: body.notes,
        deletedAt: null,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPSERT',
      entityType: 'LeaveBalance',
      entityId: record.id,
      companyId: record.companyId,
      newValue: body as unknown as Record<string, unknown>,
    });

    return record;
  }
}
