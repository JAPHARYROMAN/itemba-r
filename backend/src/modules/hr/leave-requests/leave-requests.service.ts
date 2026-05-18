import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

const LONG_LEAVE_THRESHOLD_DAYS = 5;

@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, companyId, status, leaveTypeId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    if (leaveTypeId) where.leaveTypeId = leaveTypeId;
    const [data, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          leaveType: {
            select: {
              id: true,
              name: true,
              paid: true,
              annualAllowanceDays: true,
              carryForwardAllowed: true,
            },
          },
          company: { select: { id: true, name: true } },
        },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.leaveRequest.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        leaveType: {
          select: {
            id: true,
            name: true,
            paid: true,
            annualAllowanceDays: true,
            carryForwardAllowed: true,
          },
        },
        company: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Leave request not found');
    return record;
  }

  async create(dto: CreateLeaveRequestDto, user: any) {
    const record = await this.prisma.leaveRequest.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'LeaveRequest',
      entityId: record.id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async update(id: string, dto: UpdateLeaveRequestDto, user: any) {
    const existing = await this.findOne(id, user);
    if (
      existing.status === 'APPROVED' &&
      (dto.leaveTypeId !== undefined ||
        dto.startDate !== undefined ||
        dto.endDate !== undefined ||
        dto.totalDays !== undefined)
    ) {
      throw new BadRequestException(
        'Approved leave requests cannot change leave type, dates, or days. Cancel and recreate the request.',
      );
    }
    const record = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'LeaveRequest',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async submit(id: string, user: any) {
    const record = await this.findOne(id, user);
    if (record.status !== 'DRAFT')
      throw new BadRequestException('Only draft requests can be submitted');
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: 'SUBMITTED' },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'LeaveRequest',
      entityId: id,
      newValue: { status: 'PENDING' },
    });
    return updated;
  }

  async approve(id: string, notes: string | undefined, user: any) {
    const record = await this.findOne(id, user);
    if (record.status !== 'SUBMITTED')
      throw new BadRequestException('Only submitted requests can be approved');
    if (record.groupHrApprovedById === user.id) {
      throw new BadRequestException(
        'Maker-checker: line approver and Group HR approver must differ',
      );
    }
    const now = new Date();
    const isLongLeave = Number(record.totalDays) > LONG_LEAVE_THRESHOLD_DAYS;
    const data: any = {
      lineApprovedById: user.id,
      lineApprovedAt: now,
      approvalNotes: mergeNotes(record.approvalNotes, notes),
    };
    if (!isLongLeave || record.groupHrApprovedById) {
      data.status = 'APPROVED';
      data.approvedById = record.groupHrApprovedById ?? user.id;
      data.approvedAt = now;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.leaveRequest.update({
        where: { id },
        data,
      });
      if (data.status === 'APPROVED') {
        await this.applyLeaveBalanceUsage(id, tx);
      }
      return next;
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'LeaveRequest',
      entityId: id,
      newValue: {
        lineApprovedById: user.id,
        status: updated.status,
        longLeaveRequiresGroupHr: isLongLeave,
      },
    });
    return updated;
  }

  async approveHr(id: string, notes: string | undefined, user: any) {
    const record = await this.findOne(id, user);
    if (record.status !== 'SUBMITTED')
      throw new BadRequestException('Only submitted requests can be approved');
    if (Number(record.totalDays) <= LONG_LEAVE_THRESHOLD_DAYS) {
      throw new BadRequestException('Group HR approval is only required for long leave requests');
    }
    if (record.lineApprovedById === user.id) {
      throw new BadRequestException(
        'Maker-checker: Group HR approver and line approver must differ',
      );
    }
    const now = new Date();
    const data: any = {
      groupHrApprovedById: user.id,
      groupHrApprovedAt: now,
      approvalNotes: mergeNotes(record.approvalNotes, notes),
    };
    if (record.lineApprovedById) {
      data.status = 'APPROVED';
      data.approvedById = user.id;
      data.approvedAt = now;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.leaveRequest.update({
        where: { id },
        data,
      });
      if (data.status === 'APPROVED') {
        await this.applyLeaveBalanceUsage(id, tx);
      }
      return next;
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'LeaveRequest',
      entityId: id,
      newValue: {
        groupHrApprovedById: user.id,
        status: updated.status,
      },
    });
    return updated;
  }

  async reject(id: string, reason: string | undefined, user: any) {
    const record = await this.findOne(id, user);
    if (record.status !== 'SUBMITTED')
      throw new BadRequestException('Only submitted requests can be rejected');
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedById: user.id,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'LeaveRequest',
      entityId: id,
      newValue: { status: 'REJECTED' },
    });
    return updated;
  }

  async remove(id: string, user: any) {
    const existing = await this.findOne(id, user);
    await this.prisma.$transaction(async (tx) => {
      if (existing.status === 'APPROVED') {
        await this.reverseLeaveBalanceUsage(id, tx);
      }
      await tx.leaveRequest.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          ...(existing.status === 'APPROVED' ? { status: 'CANCELLED' as const } : {}),
        },
      });
    });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'LeaveRequest',
      entityId: id,
      newValue: {},
    });
    return { message: 'Leave request deleted' };
  }

  private async applyLeaveBalanceUsage(leaveRequestId: string, tx: Prisma.TransactionClient) {
    const request = await tx.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { leaveType: true },
    });
    if (!request || request.deletedAt) return;

    const allowance = request.leaveType.annualAllowanceDays;
    if (!request.leaveType.paid || allowance == null) return;

    const year = request.startDate.getUTCFullYear();
    await tx.leaveBalance.upsert({
      where: {
        companyId_employeeId_leaveTypeId_year: {
          companyId: request.companyId,
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          year,
        },
      },
      create: {
        companyId: request.companyId,
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        year,
        allocatedDays: allowance,
        carriedForwardDays: 0,
        usedDays: 0,
      },
      update: { deletedAt: null },
    });

    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        allocatedDays: Prisma.Decimal;
        carriedForwardDays: Prisma.Decimal;
        usedDays: Prisma.Decimal;
      }>
    >`
      SELECT id, "allocatedDays", "carriedForwardDays", "usedDays"
      FROM "leave_balances"
      WHERE "companyId" = ${request.companyId}
        AND "employeeId" = ${request.employeeId}
        AND "leaveTypeId" = ${request.leaveTypeId}
        AND "year" = ${year}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    const balance = rows[0];
    if (!balance) throw new BadRequestException('Leave balance could not be created');

    const totalDays = decimal(request.totalDays);
    const newUsed = decimal(balance.usedDays).plus(totalDays);
    const available = decimal(balance.allocatedDays).plus(decimal(balance.carriedForwardDays));
    if (newUsed.gt(available)) {
      throw new BadRequestException(
        `Insufficient leave balance: available ${available.toFixed(2)} day(s), requested ${totalDays.toFixed(2)} day(s).`,
      );
    }

    await tx.leaveBalance.update({
      where: { id: balance.id },
      data: { usedDays: newUsed },
    });
  }

  private async reverseLeaveBalanceUsage(leaveRequestId: string, tx: Prisma.TransactionClient) {
    const request = await tx.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { leaveType: true },
    });
    if (!request) return;

    const year = request.startDate.getUTCFullYear();
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        usedDays: Prisma.Decimal;
      }>
    >`
      SELECT id, "usedDays"
      FROM "leave_balances"
      WHERE "companyId" = ${request.companyId}
        AND "employeeId" = ${request.employeeId}
        AND "leaveTypeId" = ${request.leaveTypeId}
        AND "year" = ${year}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    const balance = rows[0];
    if (!balance) return;

    const reducedUsed = decimal(balance.usedDays).minus(decimal(request.totalDays));
    const newUsed = reducedUsed.lt(0) ? decimal(0) : reducedUsed;
    await tx.leaveBalance.update({
      where: { id: balance.id },
      data: { usedDays: newUsed },
    });
  }
}

function mergeNotes(existing?: string | null, incoming?: string): string | undefined {
  if (!incoming?.trim()) return existing ?? undefined;
  return [existing, incoming.trim()].filter(Boolean).join('\n');
}

type DecimalInput = ConstructorParameters<typeof Prisma.Decimal>[0];

function decimal(value: DecimalInput | null | undefined): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value ?? 0);
}
