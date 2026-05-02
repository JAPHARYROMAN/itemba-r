import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, AnalyticsRunType, AnalyticsRunStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { GenerateSnapshotDto } from './dto/generate-snapshot.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class KpiSnapshotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private calculateKpiValue(): number {
    return 0;
  }

  async generate(dto: GenerateSnapshotDto, user: any) {
    const run = await this.prisma.analyticsSnapshotRun.create({
      data: {
        runNumber: `SNAP-${Date.now()}`,
        runType: AnalyticsRunType.KPI_SNAPSHOT,
        startedById: user.id,
        startedAt: new Date(),
        status: AnalyticsRunStatus.RUNNING,
        companyId: dto.companyId,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
      },
    });

    const snapshots: any[] = [];
    for (const kpiIndicatorId of dto.kpiIndicatorIds) {
      this.calculateKpiValue();
      const snapshot = await this.prisma.kPISnapshot.create({
        data: {
          kpiIndicatorId,
          value: new Prisma.Decimal(0),
          snapshotDate: new Date(),
          periodType: dto.periodType,
          periodStart: new Date(dto.periodStart),
          periodEnd: new Date(dto.periodEnd),
          companyId: dto.companyId,
          divisionId: dto.divisionId,
          branchId: dto.branchId,
          licensedBusinessUnitId: dto.licensedBusinessUnitId,
        },
      });
      snapshots.push(snapshot);
    }

    const completedRun = await this.prisma.analyticsSnapshotRun.update({
      where: { id: run.id },
      data: { status: AnalyticsRunStatus.COMPLETED, completedAt: new Date() },
    });

    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'KPISnapshot', entityId: run.id, newValue: dto as any });
    return { run: completedRun, snapshots };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, kpiIndicatorId, companyId, periodType, from, to } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (kpiIndicatorId) where.kpiIndicatorId = kpiIndicatorId;
    applyCompanyScopeWhere(where, user, companyId);
    if (periodType) where.periodType = periodType;
    if (from || to) {
      where.snapshotDate = {};
      if (from) where.snapshotDate.gte = new Date(from);
      if (to) where.snapshotDate.lte = new Date(to);
    }
    const [data, total] = await Promise.all([
      this.prisma.kPISnapshot.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.kPISnapshot.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.kPISnapshot.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('KPI Snapshot not found');
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.kPISnapshot.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'KPISnapshot', entityId: id, newValue: {} as any });
    return { message: 'Deleted' };
  }
}
