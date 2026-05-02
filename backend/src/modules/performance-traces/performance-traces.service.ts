import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class PerformanceTracesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const {
      page = 1,
      pageSize = 20,
      traceType,
      status,
      companyId,
      minDurationMs,
      maxDurationMs,
    } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = {};
    if (traceType) where.traceType = traceType;
    if (status) where.status = status;
    applyCompanyScopeWhere(where, user, companyId);
    if (minDurationMs || maxDurationMs) {
      where.durationMs = {};
      if (minDurationMs) where.durationMs.gte = Number(minDurationMs);
      if (maxDurationMs) where.durationMs.lte = Number(maxDurationMs);
    }

    const [data, total] = await Promise.all([
      this.prisma.performanceTrace.findMany({
        where,
        skip,
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.performanceTrace.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.performanceTrace.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Performance trace not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.performanceTrace.create({
      data: {
        traceNumber: 'TRC-' + Date.now(),
        traceType: dto.traceType,
        companyId: dto.companyId ?? null,
        userId: dto.userId ?? userId,
        path: dto.path ?? null,
        operationName: dto.operationName ?? null,
        durationMs: Number(dto.durationMs),
        status: dto.status ?? 'SUCCESS',
        metadata: dto.metadata ?? undefined,
      },
    });
    return record;
  }

  async purgeOld(userId: string) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const { count } = await this.prisma.performanceTrace.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    await this.auditLogs.log({
      action: 'PERFORMANCE_TRACES_PURGED',
      entityType: 'PerformanceTrace',
      userId,
      metadata: { deletedCount: count, olderThanDays: 30 },
      severity: AuditSeverity.HIGH,
    });
    return { deleted: count };
  }
}
