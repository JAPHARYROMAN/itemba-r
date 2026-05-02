import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
@Injectable()
export class TrainingEnvironmentService {
  constructor(private readonly prisma: PrismaService, private readonly auditLogs: AuditLogsService) {}
  async create(dto: any, userId: string) {
    const record = await this.prisma.trainingEnvironmentConfig.create({ data: { configCode: 'TE-' + Date.now(), name: dto.name, description: dto.description, environment: dto.environment ?? 'TRAINING', status: 'ACTIVE', createdById: userId } });
    await this.auditLogs.log({ action: 'TRAINING_ENV_CREATED', entityType: 'TrainingEnvironmentConfig', entityId: record.id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }
  async findAll() {
    return this.prisma.trainingEnvironmentConfig.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }
  async findOne(id: string) {
    const record = await this.prisma.trainingEnvironmentConfig.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Training environment not found');
    return record;
  }
  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.trainingEnvironmentConfig.update({ where: { id }, data: { ...(dto.name !== undefined && { name: dto.name }), ...(dto.description !== undefined && { description: dto.description }), ...(dto.connectionConfig !== undefined && { connectionConfig: dto.connectionConfig }) } });
    await this.auditLogs.log({ action: 'TRAINING_ENV_UPDATED', entityType: 'TrainingEnvironmentConfig', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.trainingEnvironmentConfig.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: 'TRAINING_ENV_' + status, entityType: 'TrainingEnvironmentConfig', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async resetDemoData(id: string, userId: string) {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException('Cannot reset production data');
    await this.findOne(id);
    const record = await this.prisma.trainingEnvironmentConfig.update({ where: { id }, data: { lastResetAt: new Date() } });
    await this.auditLogs.log({ action: 'TRAINING_ENV_DEMO_RESET', entityType: 'TrainingEnvironmentConfig', entityId: id, userId, severity: AuditSeverity.HIGH });
    return record;
  }
  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.trainingEnvironmentConfig.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'TRAINING_ENV_DELETED', entityType: 'TrainingEnvironmentConfig', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return { success: true };
  }
}
