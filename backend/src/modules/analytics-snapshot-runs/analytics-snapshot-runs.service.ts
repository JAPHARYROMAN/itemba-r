import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, AnalyticsRunStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { pagination } from '../../common/utils/pagination';
import { paginatedResponse } from '../../common/utils/paginated-response';
import { QueryAnalyticsSnapshotRunDto } from './dto/analytics-snapshot-run.dto';

@Injectable()
export class AnalyticsSnapshotRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: QueryAnalyticsSnapshotRunDto) {
    const { page = 1, limit = 20, runType, status, companyId } = query;
    const paging = pagination({ page, limit });
    const where: Prisma.AnalyticsSnapshotRunWhereInput = {
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (runType) where.runType = runType;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.analyticsSnapshotRun.findMany({
        where,
        skip: paging.skip,
        take: paging.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.analyticsSnapshotRun.count({ where }),
    ]);
    return paginatedResponse({ data, total, page: paging.page, limit: paging.limit });
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.analyticsSnapshotRun.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Analytics Snapshot Run not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async cancel(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.analyticsSnapshotRun.update({ where: { id }, data: { status: AnalyticsRunStatus.CANCELLED } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AnalyticsSnapshotRun', entityId: id, newValue: { status: AnalyticsRunStatus.CANCELLED } });
    return record;
  }
}
