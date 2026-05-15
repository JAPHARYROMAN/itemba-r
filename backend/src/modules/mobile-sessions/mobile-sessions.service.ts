import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity, MobileSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { QueryMobileSessionDto } from './dto/query-mobile-session.dto';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const SAFE_SELECT = {
  id: true,
  sessionCode: true,
  userId: true,
  deviceId: true,
  companyId: true,
  ipAddress: true,
  userAgent: true,
  appVersion: true,
  status: true,
  startedAt: true,
  expiresAt: true,
  lastActivityAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class MobileSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: QueryMobileSessionDto, user?: AuthUser) {
    const { page = 1, limit = 20, userId, deviceId, companyId, status } = query;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (userId) where.userId = userId;
    if (deviceId) where.deviceId = deviceId;
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.mobileSession.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.mobileSession.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.mobileSession.findFirst({
      where: { id },
      select: SAFE_SELECT,
    });
    if (!record) throw new NotFoundException('Mobile session not found');
    assertCanAccessCompanyFromUser(user, record.companyId);
    return record;
  }

  async revoke(id: string, user: AuthUser) {
    const record = await this.prisma.mobileSession.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Mobile session not found');
    assertCanAccessCompanyFromUser(user, record.companyId);

    const updated = await this.prisma.mobileSession.update({
      where: { id },
      data: { status: MobileSessionStatus.REVOKED, revokedAt: new Date() },
      select: SAFE_SELECT,
    });

    await this.auditLogs.log({
      action: 'MOBILE_SESSION_REVOKED',
      entityType: 'MobileSession',
      entityId: id,
      userId: user.id,
      severity: AuditSeverity.MEDIUM,
    });

    return updated;
  }
}
