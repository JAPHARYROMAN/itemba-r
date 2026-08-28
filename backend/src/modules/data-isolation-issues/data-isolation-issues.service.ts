import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditScopeKind, AuditSeverity, DataIsolationIssueStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { pagination } from '../../common/utils/pagination';
import { paginatedResponse } from '../../common/utils/paginated-response';
import { QueryDataIsolationIssueDto } from './dto/data-isolation-issue.dto';

@Injectable()
export class DataIsolationIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryDataIsolationIssueDto, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'view data isolation issues');
    const { page = 1, pageSize = 20, status, severity, issueType } = query;
    const paging = pagination({ page, limit: pageSize });
    const where: Prisma.DataIsolationTestIssueWhereInput = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (issueType) where.issueType = issueType;

    const [data, total] = await Promise.all([
      this.prisma.dataIsolationTestIssue.findMany({
        where,
        skip: paging.skip,
        take: paging.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dataIsolationTestIssue.count({ where }),
    ]);
    return {
      ...paginatedResponse({ data, total, page: paging.page, limit: paging.limit }),
      pageSize: paging.limit,
    };
  }

  async findOne(id: string, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'view data isolation issues');
    const record = await this.prisma.dataIsolationTestIssue.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Data isolation issue not found');
    return record;
  }

  async setStatus(id: string, status: DataIsolationIssueStatus, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'resolve data isolation issues');
    await this.findOne(id, user);
    const record = await this.prisma.dataIsolationTestIssue.update({
      where: { id },
      data: { status },
    });
    await this.auditLogs.log({
      action: `DATA_ISOLATION_ISSUE_${status}`,
      entityType: 'DataIsolationTestIssue',
      entityId: id,
      userId: user.id,
      scopeKind: AuditScopeKind.GLOBAL,
      companyScopeIds: [],
      severity: AuditSeverity.MEDIUM,
    });
    return record;
  }
}
