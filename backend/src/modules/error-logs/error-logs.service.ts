import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

function hasPermission(user: any, perm: string): boolean {
  return Array.isArray(user?.permissions) && user.permissions.includes(perm);
}

function buildSelect(includeSensitive: boolean) {
  return {
    id: true,
    errorNumber: true,
    companyId: true,
    userId: true,
    module: true,
    errorType: true,
    message: true,
    requestPath: true,
    requestMethod: true,
    statusCode: true,
    ipAddress: true,
    userAgent: true,
    correlationId: true,
    severity: true,
    status: true,
    metadata: true,
    createdAt: true,
    updatedAt: true,
    ...(includeSensitive ? { stackTrace: true } : {}),
  };
}

@Injectable()
export class ErrorLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user: any) {
    const { page = 1, limit = 20, companyId, userId, errorType, severity, status, module } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (userId) where.userId = userId;
    if (errorType) where.errorType = errorType;
    if (severity) where.severity = severity;
    if (status) where.status = status;
    if (module) where.module = module;
    const canSeeSensitive = hasPermission(user, 'error_logs.sensitive.view');

    const [data, total] = await Promise.all([
      this.prisma.errorLog.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, select: buildSelect(canSeeSensitive) }),
      this.prisma.errorLog.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const canSeeSensitive = hasPermission(user, 'error_logs.sensitive.view');
    const record = await this.prisma.errorLog.findFirst({ where: { id }, select: buildSelect(canSeeSensitive) });
    if (!record) throw new NotFoundException('Error log not found');
    return record;
  }

  async updateStatus(id: string, status: string, userId: string) {
    const record = await this.prisma.errorLog.update({
      where: { id },
      data: { status: status as any },
      select: buildSelect(false),
    });
    await this.auditLogs.log({ action: `ERROR_LOG_${status}`, entityType: 'ErrorLog', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }
}
