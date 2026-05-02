import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class ProductionReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, limit = 20, category, status, priority } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (category) where.category = category;
    if (status) where.status = status;
    if (priority) where.priority = priority;

    const [data, total] = await Promise.all([
      this.prisma.productionReadinessCheck.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.productionReadinessCheck.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.productionReadinessCheck.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Production readiness check not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.productionReadinessCheck.create({
      data: {
        checkCode: 'PR-' + Date.now(),
        category: dto.category,
        title: dto.title,
        description: dto.description,
        status: dto.status ?? 'NOT_STARTED',
        priority: dto.priority ?? 'MEDIUM',
        responsibleUserId: dto.responsibleUserId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        evidenceDocumentId: dto.evidenceDocumentId,
        notes: dto.notes,
      },
    });
    await this.auditLogs.log({ action: 'PROD_READINESS_CREATED', entityType: 'ProductionReadinessCheck', entityId: record.id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.productionReadinessCheck.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.responsibleUserId !== undefined && { responsibleUserId: dto.responsibleUserId }),
        ...(dto.dueDate !== undefined && { dueDate: new Date(dto.dueDate) }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.evidenceDocumentId !== undefined && { evidenceDocumentId: dto.evidenceDocumentId }),
      },
    });
    await this.auditLogs.log({ action: 'PROD_READINESS_UPDATED', entityType: 'ProductionReadinessCheck', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.LOW });
    return record;
  }

  async markComplete(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.productionReadinessCheck.update({
      where: { id },
      data: { status: 'PASSED', completedById: userId, completedAt: new Date(), notes: dto.notes ?? existing.notes },
    });
    await this.auditLogs.log({ action: 'PROD_READINESS_COMPLETED', entityType: 'ProductionReadinessCheck', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.productionReadinessCheck.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'PROD_READINESS_DELETED', entityType: 'ProductionReadinessCheck', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return { success: true };
  }
}
