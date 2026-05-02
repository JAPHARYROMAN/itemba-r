import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class SystemHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, limit = 20, checkType, status, isActive } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (checkType) where.checkType = checkType;
    if (status) where.status = status;
    if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;

    const [data, total] = await Promise.all([
      this.prisma.systemHealthCheck.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.systemHealthCheck.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.systemHealthCheck.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Health check not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.systemHealthCheck.create({
      data: {
        healthCheckCode: 'HC-' + Date.now(),
        name: dto.name,
        checkType: dto.checkType,
        endpointOrTarget: dto.endpointOrTarget,
        status: 'UNKNOWN',
        isActive: dto.isActive ?? true,
      },
    });
    await this.auditLogs.log({ action: 'HEALTH_CHECK_CREATED', entityType: 'SystemHealthCheck', entityId: record.id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.systemHealthCheck.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.checkType !== undefined && { checkType: dto.checkType }),
        ...(dto.endpointOrTarget !== undefined && { endpointOrTarget: dto.endpointOrTarget }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    await this.auditLogs.log({ action: 'HEALTH_CHECK_UPDATED', entityType: 'SystemHealthCheck', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.LOW });
    return record;
  }

  async runCheck(id: string, userId: string) {
    const check = await this.findOne(id);
    const start = Date.now();
    let status: string = 'UNKNOWN';
    let message = '';

    try {
      if (check.checkType === 'DATABASE') {
        await this.prisma.$queryRaw`SELECT 1`;
        status = 'HEALTHY';
        message = 'Database connection OK';
      } else {
        status = 'UNKNOWN';
        message = `Check type ${check.checkType} not automated`;
      }
    } catch (err: any) {
      status = 'CRITICAL';
      message = err?.message ?? 'Check failed';
    }

    const durationMs = Date.now() - start;
    const now = new Date();
    const record = await this.prisma.systemHealthCheck.update({
      where: { id },
      data: {
        status: status as any,
        lastCheckedAt: now,
        lastMessage: message,
        responseTimeMs: durationMs,
        ...(status === 'HEALTHY' ? { lastSuccessAt: now } : { lastFailureAt: now }),
      },
    });

    await this.auditLogs.log({ action: 'HEALTH_CHECK_RUN', entityType: 'SystemHealthCheck', entityId: id, userId, metadata: { status, durationMs }, severity: AuditSeverity.LOW });
    return record;
  }

  async runAll(userId: string) {
    const checks = await this.prisma.systemHealthCheck.findMany({ where: { deletedAt: null, isActive: true } });
    const results = await Promise.all(checks.map((c) => this.runCheck(c.id, userId)));
    return { ran: results.length, results };
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.systemHealthCheck.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'HEALTH_CHECK_DELETED', entityType: 'SystemHealthCheck', entityId: id, userId, severity: AuditSeverity.LOW });
    return { success: true };
  }
}
