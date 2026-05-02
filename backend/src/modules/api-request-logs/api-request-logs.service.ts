import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService, applyCompanyScopeWhere } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { QueryApiRequestLogDto } from './dto/query-api-request-log.dto';

@Injectable()
export class ApiRequestLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryApiRequestLogDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      apiClientId,
      apiKeyId,
      statusCode,
      rateLimited,
      companyId,
    } = query;
    const skip = (page - 1) * limit;
    const where: any = await this.companyScope.companyWhereFor(user, companyId);
    if (apiClientId) where.apiClientId = apiClientId;
    if (apiKeyId) where.apiKeyId = apiKeyId;
    if (statusCode !== undefined) where.statusCode = statusCode;
    if (rateLimited !== undefined) where.rateLimited = rateLimited;
    applyCompanyScopeWhere(where, user, companyId);

    const [data, total] = await Promise.all([
      this.prisma.apiRequestLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.apiRequestLog.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
