import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class LaunchBlockersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: any, userId: string) {
    const record = await this.prisma.launchBlocker.create({
      data: {
        blockerNumber: `LB-${Date.now()}`,
        title: dto.title,
        description: dto.description,
        severity: dto.severity ?? 'MEDIUM',
        blockerType: dto.blockerType,
        moduleName: dto.moduleName,
        companyId: dto.companyId,
        assignedToId: dto.assignedToId,
        targetResolutionDate: dto.targetResolutionDate ? new Date(dto.targetResolutionDate) : undefined,
        status: 'OPEN',
        reportedById: userId,
      },
    });
    await this.auditLogs.log({ action: 'LAUNCH_BLOCKER_CREATED', entityType: 'LaunchBlocker', entityId: record.id, userId, severity: AuditSeverity.HIGH });
    return record;
  }

  async findAll(query: any, user?: any) {
    const { page = 1, pageSize = 20, status, severity, blockerType, moduleName, companyId, assignedToId } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (blockerType) where.blockerType = blockerType;
    if (moduleName) where.moduleName = moduleName;
    applyCompanyScopeWhere(where, user, companyId);
    if (assignedToId) where.assignedToId = assignedToId;
    const [data, total] = await Promise.all([
      this.prisma.launchBlocker.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }),
      this.prisma.launchBlocker.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.launchBlocker.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Launch blocker not found');
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.launchBlocker.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.assignedToId !== undefined && { assignedToId: dto.assignedToId }),
        ...(dto.targetResolutionDate !== undefined && { targetResolutionDate: new Date(dto.targetResolutionDate) }),
        ...(dto.moduleName !== undefined && { moduleName: dto.moduleName }),
      },
    });
    await this.auditLogs.log({ action: 'LAUNCH_BLOCKER_UPDATED', entityType: 'LaunchBlocker', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.launchBlocker.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: `LAUNCH_BLOCKER_${status}`, entityType: 'LaunchBlocker', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async resolve(id: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.launchBlocker.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedById: userId, resolvedAt: new Date() },
    });
    await this.auditLogs.log({ action: 'LAUNCH_BLOCKER_RESOLVED', entityType: 'LaunchBlocker', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async acceptRisk(id: string, dto: any, userId: string) {
    if (!dto.acceptanceReason) throw new BadRequestException('acceptanceReason is required');
    await this.findOne(id);
    const record = await this.prisma.launchBlocker.update({
      where: { id },
      data: { status: 'ACCEPTED_RISK', acceptanceReason: dto.acceptanceReason },
    });
    await this.auditLogs.log({
      action: 'LAUNCH_BLOCKER_RISK_ACCEPTED',
      entityType: 'LaunchBlocker',
      entityId: id,
      userId,
      severity: AuditSeverity.HIGH,
      metadata: { reason: dto.acceptanceReason } as any,
    });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.launchBlocker.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'LAUNCH_BLOCKER_DELETED', entityType: 'LaunchBlocker', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return { success: true };
  }
}
