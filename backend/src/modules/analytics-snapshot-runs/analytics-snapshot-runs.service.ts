import { Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsRunStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class AnalyticsSnapshotRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, runType, status, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (runType) where.runType = runType;
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    else if (user.companyId) where.companyId = user.companyId;
    const [data, total] = await Promise.all([
      this.prisma.analyticsSnapshotRun.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.analyticsSnapshotRun.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.analyticsSnapshotRun.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Analytics Snapshot Run not found');
    return record;
  }

  async cancel(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.analyticsSnapshotRun.update({ where: { id }, data: { status: AnalyticsRunStatus.CANCELLED } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AnalyticsSnapshotRun', entityId: id, newValue: { status: 'CANCELLED' } as any });
    return record;
  }
}
