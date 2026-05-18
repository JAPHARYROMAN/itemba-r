import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma, AnalyticsRunType, AnalyticsRunStatus, KPISnapshot } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { GenerateSnapshotDto } from './dto/generate-snapshot.dto';
import { CompanyScopeService } from '../../common/services';
import { auditRecord } from '../../common/utils/audit-record';
import { pagination } from '../../common/utils/pagination';
import { paginatedResponse } from '../../common/utils/paginated-response';
import { QueryKpiSnapshotDto } from './dto/query-kpi-snapshot.dto';

@Injectable()
export class KpiSnapshotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  private calculateKpiValue(): number {
    return 0;
  }

  async generate(dto: GenerateSnapshotDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
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

    const snapshots: KPISnapshot[] = [];
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

    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'KPISnapshot', entityId: run.id, newValue: auditRecord(dto) });
    return { run: completedRun, snapshots };
  }

  async findAll(user: AuthUser, query: QueryKpiSnapshotDto) {
    const { page = 1, limit = 20, kpiIndicatorId, companyId, periodType, from, to } = query;
    const paging = pagination({ page, limit });
    const where: Prisma.KPISnapshotWhereInput = {};
    if (kpiIndicatorId) where.kpiIndicatorId = kpiIndicatorId;
    Object.assign(where, await this.companyScope.companyWhereFor(user, companyId));
    if (periodType) where.periodType = periodType;
    if (from || to) {
      where.snapshotDate = {};
      if (from) where.snapshotDate.gte = new Date(from);
      if (to) where.snapshotDate.lte = new Date(to);
    }
    const [data, total] = await Promise.all([
      this.prisma.kPISnapshot.findMany({
        where,
        skip: paging.skip,
        take: paging.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.kPISnapshot.count({ where }),
    ]);
    return paginatedResponse({ data, total, page: paging.page, limit: paging.limit });
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.kPISnapshot.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('KPI Snapshot not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    await this.prisma.kPISnapshot.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'KPISnapshot', entityId: id, newValue: {} });
    return { message: 'Deleted' };
  }
}
