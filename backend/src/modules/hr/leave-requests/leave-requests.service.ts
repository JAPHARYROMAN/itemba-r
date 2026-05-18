import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
          leaveType: { select: { id: true, name: true } },
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
        leaveType: { select: { id: true, name: true } },
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
    await this.findOne(id, user);
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
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data,
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
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data,
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
    await this.findOne(id, user);
    await this.prisma.leaveRequest.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'LeaveRequest',
      entityId: id,
      newValue: {},
    });
    return { message: 'Leave request deleted' };
  }
}

function mergeNotes(existing?: string | null, incoming?: string): string | undefined {
  if (!incoming?.trim()) return existing ?? undefined;
  return [existing, incoming.trim()].filter(Boolean).join('\n');
}
