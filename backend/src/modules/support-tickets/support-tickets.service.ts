import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../common/services';

@Injectable()
export class SupportTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: any, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, dto.companyId);
    const record = await this.prisma.supportTicket.create({
      data: {
        ticketNumber: 'ST-' + Date.now(),
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? 'NORMAL',
        ticketType: dto.ticketType,
        moduleName: dto.moduleName,
        companyId: dto.companyId,
        status: 'OPEN',
        reportedById: user.id,
      },
    });
    await this.auditLogs.log({
      action: 'SUPPORT_TICKET_CREATED',
      entityType: 'SupportTicket',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      severity: AuditSeverity.MEDIUM,
    });
    return record;
  }

  async findAll(query: any, user?: AuthUser) {
    const {
      page = 1,
      pageSize = 20,
      status,
      priority,
      ticketType,
      companyId,
      assignedToId,
    } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (ticketType) where.ticketType = ticketType;
    applyCompanyScopeWhere(where, user, companyId);
    if (assignedToId) where.assignedToId = assignedToId;
    const [data, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' },
        include: {
          reportedBy: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findMine(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { reportedById: userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        reportedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  async findOne(id: string, user: AuthUser) {
    const canViewInternal = user.permissions?.includes('support.internal_comments.view');
    const record = await this.prisma.supportTicket.findFirst({
      where: { id, deletedAt: null },
      include: {
        reportedBy: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        comments: {
          where: { deletedAt: null, ...(canViewInternal ? {} : { internal: false }) },
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Support ticket not found');
    assertCanAccessCompanyFromUser(user, record.companyId);
    return record;
  }

  async update(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOneBasic(id, user);
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      assertCanAccessCompanyFromUser(user, dto.companyId);
    }
    const record = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.moduleName !== undefined && { moduleName: dto.moduleName }),
        ...(dto.companyId !== undefined && { companyId: dto.companyId }),
      },
    });
    await this.auditLogs.log({
      action: 'SUPPORT_TICKET_UPDATED',
      entityType: 'SupportTicket',
      entityId: id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      severity: AuditSeverity.LOW,
    });
    return record;
  }

  async assign(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOneBasic(id, user);
    const record = await this.prisma.supportTicket.update({
      where: { id },
      data: { assignedToId: dto.assignedToId },
    });
    await this.auditLogs.log({
      action: 'SUPPORT_TICKET_ASSIGNED',
      entityType: 'SupportTicket',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      severity: AuditSeverity.MEDIUM,
      metadata: { assignedToId: dto.assignedToId } as any,
    });
    return record;
  }

  async setStatus(id: string, status: string, user: AuthUser) {
    const existing = await this.findOneBasic(id, user);
    const record = await this.prisma.supportTicket.update({
      where: { id },
      data: { status: status as any },
    });
    await this.auditLogs.log({
      action: 'SUPPORT_TICKET_' + status,
      entityType: 'SupportTicket',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      severity: AuditSeverity.LOW,
    });
    return record;
  }

  async resolve(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOneBasic(id, user);
    const record = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolution: dto.resolution,
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
    });
    await this.auditLogs.log({
      action: 'SUPPORT_TICKET_RESOLVED',
      entityType: 'SupportTicket',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      severity: AuditSeverity.MEDIUM,
    });
    return record;
  }

  async close(id: string, user: AuthUser) {
    const existing = await this.findOneBasic(id, user);
    const record = await this.prisma.supportTicket.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'SUPPORT_TICKET_CLOSED',
      entityType: 'SupportTicket',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      severity: AuditSeverity.LOW,
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOneBasic(id, user);
    await this.prisma.supportTicket.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'SUPPORT_TICKET_DELETED',
      entityType: 'SupportTicket',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      severity: AuditSeverity.MEDIUM,
    });
    return { success: true };
  }

  private async findOneBasic(id: string, user?: AuthUser) {
    const record = await this.prisma.supportTicket.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Support ticket not found');
    if (user) assertCanAccessCompanyFromUser(user, record.companyId);
    return record;
  }
}
