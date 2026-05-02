import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class DisasterRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { page = 1, limit = 20, companyId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.disasterRecoveryPlan.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.disasterRecoveryPlan.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.disasterRecoveryPlan.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Disaster recovery plan not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.disasterRecoveryPlan.create({
      data: {
        drPlanCode: 'DR-' + Date.now(),
        name: dto.name,
        description: dto.description,
        recoveryPointObjectiveMinutes: dto.recoveryPointObjectiveMinutes ?? 60,
        recoveryTimeObjectiveMinutes: dto.recoveryTimeObjectiveMinutes ?? 240,
        criticalSystems: dto.criticalSystems ?? [],
        backupStrategy: dto.backupStrategy,
        recoverySteps: dto.recoverySteps,
        responsibleUsers: dto.responsibleUsers ?? [],
        emergencyContacts: dto.emergencyContacts ?? [],
        status: dto.status ?? 'DRAFT',
        companyId: dto.companyId,
        createdById: userId,
      },
    });
    await this.auditLogs.log({ action: 'DR_PLAN_CREATED', entityType: 'DisasterRecoveryPlan', entityId: record.id, userId, severity: AuditSeverity.HIGH });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.disasterRecoveryPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.recoveryPointObjectiveMinutes !== undefined && { recoveryPointObjectiveMinutes: dto.recoveryPointObjectiveMinutes }),
        ...(dto.recoveryTimeObjectiveMinutes !== undefined && { recoveryTimeObjectiveMinutes: dto.recoveryTimeObjectiveMinutes }),
        ...(dto.criticalSystems !== undefined && { criticalSystems: dto.criticalSystems }),
        ...(dto.backupStrategy !== undefined && { backupStrategy: dto.backupStrategy }),
        ...(dto.recoverySteps !== undefined && { recoverySteps: dto.recoverySteps }),
        ...(dto.responsibleUsers !== undefined && { responsibleUsers: dto.responsibleUsers }),
        ...(dto.emergencyContacts !== undefined && { emergencyContacts: dto.emergencyContacts }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
    await this.auditLogs.log({ action: 'DR_PLAN_UPDATED', entityType: 'DisasterRecoveryPlan', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async approve(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.disasterRecoveryPlan.update({
      where: { id },
      data: { status: 'ACTIVE', approvedById: userId, approvedAt: new Date() },
    });
    await this.auditLogs.log({ action: 'DR_PLAN_APPROVED', entityType: 'DisasterRecoveryPlan', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.HIGH });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.disasterRecoveryPlan.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'DR_PLAN_DELETED', entityType: 'DisasterRecoveryPlan', entityId: id, userId, severity: AuditSeverity.HIGH });
    return { success: true };
  }
}
