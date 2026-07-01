import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { companyWhereForUser, isGroupScopedUser } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class SecurityEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Build the company-scope predicate for security events.
   *
   * Authentication-origin events (LOGIN_FAILED, ACCOUNT_LOCKED, TWO_FACTOR_*,
   * PASSWORD_RESET_*, SUSPICIOUS_ACTIVITY) are logged with companyId=null by
   * design (they are group-level, not tenant-scoped). A plain company scope
   * ({companyId:{in:[...]}}) can never match a null companyId, which made those
   * events permanently unreviewable (audit HIGH). Group-scoped viewers oversee
   * group-level records, so we additionally surface companyId:null rows to them
   * WITHOUT loosening tenant isolation for company-scoped rows. Regular
   * company-scoped users keep the strict scope and never see null rows.
   */
  private scopeWhere(user: AuthUser | undefined, requestedCompanyId?: string | null): any {
    const scope = companyWhereForUser(user, requestedCompanyId);
    // Only widen to include group-level (null companyId) auth events when the
    // viewer is group-scoped and is not narrowing to a single requested company.
    if (user && isGroupScopedUser(user) && !requestedCompanyId) {
      return { OR: [scope, { companyId: null }] };
    }
    return scope;
  }

  async findAll(query: any, user?: any) {
    const { page = 1, limit = 20, eventType, severity, status, userId, companyId, dateFrom, dateTo } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (eventType) where.eventType = eventType;
    if (severity) where.severity = severity;
    if (status) where.status = status;
    if (userId) where.userId = userId;
    Object.assign(where, this.scopeWhere(user, companyId));
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.securityEvent.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.securityEvent.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user?: any) {
    const where: Record<string, unknown> = { id };
    if (user) Object.assign(where, this.scopeWhere(user, null));
    const record = await this.prisma.securityEvent.findFirst({ where });
    if (!record) throw new NotFoundException('Security event not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.securityEvent.create({
      data: {
        eventNumber: 'SE-' + Date.now(),
        eventType: dto.eventType,
        severity: dto.severity ?? 'MEDIUM',
        description: dto.description,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        locationSummary: dto.locationSummary,
        metadata: dto.metadata ?? {},
        status: dto.status ?? 'OPEN',
        companyId: dto.companyId,
        userId: dto.userId,
        apiClientId: dto.apiClientId,
        deviceId: dto.deviceId,
      },
    });
    await this.auditLogs.log({ action: 'SECURITY_EVENT_CREATED', entityType: 'SecurityEvent', entityId: record.id, userId, newValue: record as any, severity: AuditSeverity.HIGH });
    return record;
  }

  async review(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.securityEvent.update({
      where: { id },
      data: { status: 'REVIEWED', reviewedById: userId, reviewedAt: new Date() },
    });
    await this.auditLogs.log({ action: 'SECURITY_EVENT_REVIEWED', entityType: 'SecurityEvent', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async resolve(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.securityEvent.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedById: userId, resolvedAt: new Date() },
    });
    await this.auditLogs.log({ action: 'SECURITY_EVENT_RESOLVED', entityType: 'SecurityEvent', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.MEDIUM });
    return record;
  }
}
