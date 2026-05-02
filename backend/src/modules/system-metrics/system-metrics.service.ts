import { Injectable } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class SystemMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { page = 1, limit = 20, metricType, companyId, dateFrom, dateTo } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (metricType) where.metricType = metricType;
    applyCompanyScopeWhere(where, user, companyId);
    if (dateFrom || dateTo) {
      where.recordedAt = {};
      if (dateFrom) where.recordedAt.gte = new Date(dateFrom);
      if (dateTo) where.recordedAt.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.systemMetric.findMany({ where, skip, take: Number(limit), orderBy: { recordedAt: 'desc' } }),
      this.prisma.systemMetric.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.systemMetric.create({
      data: {
        metricCode: 'SM-' + Date.now(),
        metricType: dto.metricType,
        value: dto.value,
        unit: dto.unit,
        companyId: dto.companyId,
        metadata: dto.metadata ?? {},
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      },
    });
    await this.auditLogs.log({ action: 'SYSTEM_METRIC_RECORDED', entityType: 'SystemMetric', entityId: record.id, userId, severity: AuditSeverity.LOW });
    return record;
  }
}
