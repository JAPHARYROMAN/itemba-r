import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class AccountingLocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { companyId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    const [items, total] = await Promise.all([
      this.prisma.accountingLock.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.accountingLock.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.accountingLock.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Accounting lock not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    this.assertValidDateRange(dto.lockedFrom, dto.lockedTo);
    await this.assertScopeBelongsToCompany(dto.companyId, dto.fiscalYearId, dto.accountingPeriodId);
    await this.assertNoOverlappingActiveLock(dto);

    const item = await this.prisma.accountingLock.create({
      data: { ...dto, status: 'ACTIVE', createdById: user.id },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'AccountingLock',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
    });
    return item;
  }

  async release(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'ACTIVE') throw new BadRequestException('Lock is not active');
    const updated = await this.prisma.accountingLock.update({
      where: { id },
      data: { status: 'RELEASED', releasedAt: new Date(), releasedById: user.id },
    });
    await this.auditLogs.log({
      action: 'RELEASE',
      entityType: 'AccountingLock',
      entityId: id,
      userId: user.id,
    });
    return updated;
  }

  private assertValidDateRange(lockedFrom?: string | Date | null, lockedTo?: string | Date | null) {
    if (!lockedFrom || !lockedTo) return;
    const from = new Date(lockedFrom);
    const to = new Date(lockedTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Lock date range is invalid');
    }
    if (from > to) {
      throw new BadRequestException('Lock start date cannot be after lock end date');
    }
  }

  private async assertScopeBelongsToCompany(
    companyId: string,
    fiscalYearId?: string,
    accountingPeriodId?: string,
  ) {
    if (accountingPeriodId) {
      const period = await this.prisma.accountingPeriod.findFirst({
        where: { id: accountingPeriodId },
        select: { companyId: true, fiscalYearId: true },
      });
      if (!period || period.companyId !== companyId) {
        throw new BadRequestException('Accounting period must belong to the lock company');
      }
      if (fiscalYearId && period.fiscalYearId !== fiscalYearId) {
        throw new BadRequestException('Accounting period must belong to the lock fiscal year');
      }
    }

    if (fiscalYearId) {
      const fiscalYear = await this.prisma.fiscalYear.findFirst({
        where: { id: fiscalYearId },
        select: { companyId: true },
      });
      if (!fiscalYear || fiscalYear.companyId !== companyId) {
        throw new BadRequestException('Fiscal year must belong to the lock company');
      }
    }
  }

  private async assertNoOverlappingActiveLock(dto: any) {
    const existing = await this.prisma.accountingLock.findFirst({
      where: {
        companyId: dto.companyId,
        status: 'ACTIVE',
        deletedAt: null,
        lockType: dto.lockType,
        moduleName: dto.moduleName ?? null,
        fiscalYearId: dto.fiscalYearId ?? null,
        accountingPeriodId: dto.accountingPeriodId ?? null,
        OR: [
          { lockedFrom: null },
          { lockedTo: null },
          {
            AND: [
              {
                lockedFrom: { lte: dto.lockedTo ? new Date(dto.lockedTo) : new Date('9999-12-31') },
              },
              {
                lockedTo: {
                  gte: dto.lockedFrom ? new Date(dto.lockedFrom) : new Date('0001-01-01'),
                },
              },
            ],
          },
        ],
      },
    });

    if (existing) {
      throw new BadRequestException('An overlapping active accounting lock already exists');
    }
  }
}
