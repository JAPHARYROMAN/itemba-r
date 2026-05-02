import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class CacheManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, pageSize = 20, cacheType, companyId } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = {};
    if (cacheType) where.cacheType = cacheType;
    if (companyId) where.companyId = companyId;

    const [data, total] = await Promise.all([
      this.prisma.cacheEntry.findMany({
        where,
        skip,
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cacheEntry.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.cacheEntry.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Cache entry not found');
    return record;
  }

  async set(dto: any) {
    return this.prisma.cacheEntry.upsert({
      where: { cacheKey: dto.cacheKey },
      create: {
        cacheKey: dto.cacheKey,
        companyId: dto.companyId ?? null,
        scopeHash: dto.scopeHash ?? null,
        cacheType: dto.cacheType ?? 'CUSTOM',
        value: dto.value,
        expiresAt: new Date(dto.expiresAt),
      },
      update: {
        value: dto.value,
        expiresAt: new Date(dto.expiresAt),
        ...(dto.scopeHash !== undefined && { scopeHash: dto.scopeHash }),
      },
    });
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.cacheEntry.delete({ where: { id } });
    await this.auditLogs.log({
      action: 'CACHE_ENTRY_INVALIDATED',
      entityType: 'CacheEntry',
      entityId: id,
      userId,
      oldValue: existing as any,
      severity: AuditSeverity.LOW,
    });
    return { success: true };
  }

  async invalidateByCompany(companyId: string, userId: string) {
    const { count } = await this.prisma.cacheEntry.deleteMany({ where: { companyId } });
    await this.auditLogs.log({
      action: 'CACHE_INVALIDATED_BY_COMPANY',
      entityType: 'CacheEntry',
      userId,
      metadata: { companyId, deletedCount: count },
      severity: AuditSeverity.MEDIUM,
    });
    return { deleted: count };
  }

  async invalidateByPrefix(prefix: string, userId: string) {
    const { count } = await this.prisma.cacheEntry.deleteMany({
      where: { cacheKey: { startsWith: prefix } },
    });
    await this.auditLogs.log({
      action: 'CACHE_INVALIDATED_BY_PREFIX',
      entityType: 'CacheEntry',
      userId,
      metadata: { prefix, deletedCount: count },
      severity: AuditSeverity.MEDIUM,
    });
    return { deleted: count };
  }

  async getStats() {
    const now = new Date();
    const [byType, expired, total] = await Promise.all([
      this.prisma.cacheEntry.groupBy({ by: ['cacheType'], _count: { id: true } }),
      this.prisma.cacheEntry.count({ where: { expiresAt: { lt: now } } }),
      this.prisma.cacheEntry.count(),
    ]);
    return {
      total,
      expired,
      byType: byType.map((r) => ({ cacheType: r.cacheType, count: r._count.id })),
    };
  }
}
