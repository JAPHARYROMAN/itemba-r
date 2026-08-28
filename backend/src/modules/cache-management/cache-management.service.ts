import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, AuditSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { SetCacheEntryDto } from './dto/set-cache-entry.dto';

@Injectable()
export class CacheManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user?: any) {
    const { page = 1, pageSize = 20, cacheType, companyId } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = {};
    if (cacheType) where.cacheType = cacheType;
    applyCompanyScopeWhere(where, user, companyId);

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

  async set(dto: SetCacheEntryDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId ?? null, AccessLevel.WRITE);
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.cacheEntry.upsert({
        where: { cacheKey: dto.cacheKey },
        create: {
          cacheKey: dto.cacheKey,
          companyId: dto.companyId ?? null,
          scopeHash: dto.scopeHash ?? null,
          cacheType: dto.cacheType ?? 'CUSTOM',
          value: dto.value as Prisma.InputJsonValue,
          expiresAt: new Date(dto.expiresAt),
        },
        update: {
          value: dto.value as Prisma.InputJsonValue,
          expiresAt: new Date(dto.expiresAt),
          ...(dto.scopeHash !== undefined && { scopeHash: dto.scopeHash }),
        },
      });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'CACHE_ENTRY_SET',
        entityType: 'CacheEntry',
        entityId: record.id,
        userId: user.id,
        companyId: record.companyId ?? undefined,
        newValue: record as unknown as Record<string, unknown>,
      });
      return record;
    });
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(
      user,
      existing.companyId ?? null,
      AccessLevel.WRITE,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.cacheEntry.delete({ where: { id } });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'CACHE_ENTRY_INVALIDATED',
        entityType: 'CacheEntry',
        entityId: id,
        userId: user.id,
        companyId: existing.companyId,
        oldValue: existing as any,
        severity: AuditSeverity.LOW,
      });
    });
    return { success: true };
  }

  async invalidateByCompany(companyId: string, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.WRITE);
    const count = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.cacheEntry.deleteMany({ where: { companyId } });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'CACHE_INVALIDATED_BY_COMPANY',
        entityType: 'CacheEntry',
        userId: user.id,
        companyId,
        metadata: { companyId, deletedCount: deleted.count },
        severity: AuditSeverity.MEDIUM,
      });
      return deleted.count;
    });
    return { deleted: count };
  }

  async invalidateByPrefix(prefix: string, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, null, AccessLevel.WRITE);
    const count = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.cacheEntry.deleteMany({
        where: { cacheKey: { startsWith: prefix } },
      });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'CACHE_INVALIDATED_BY_PREFIX',
        entityType: 'CacheEntry',
        userId: user.id,
        companyId: null,
        metadata: { prefix, deletedCount: deleted.count },
        severity: AuditSeverity.MEDIUM,
      });
      return deleted.count;
    });
    return { deleted: count };
  }

  async getStats(user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, null, AccessLevel.READ);
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
