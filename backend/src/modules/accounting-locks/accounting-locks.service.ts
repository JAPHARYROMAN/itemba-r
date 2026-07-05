import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { pagination } from '../../common/utils/pagination';
import { paginatedResponse } from '../../common/utils/paginated-response';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateAccountingLockDto, QueryAccountingLockDto } from './dto/accounting-lock.dto';

@Injectable()
export class AccountingLocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryAccountingLockDto, user: AuthUser) {
    const { companyId, page = 1, limit = 20, lockType, status } = query;
    const paging = pagination({ page, limit });
    const where: Prisma.AccountingLockWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (lockType) where.lockType = lockType;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.accountingLock.findMany({
        where,
        skip: paging.skip,
        take: paging.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.accountingLock.count({ where }),
    ]);
    return paginatedResponse({ data: items, total, page: paging.page, limit: paging.limit });
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.accountingLock.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Accounting lock not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: CreateAccountingLockDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    this.assertValidDateRange(dto.lockedFrom, dto.lockedTo);
    await this.assertScopeBelongsToCompany(dto.companyId, dto.fiscalYearId, dto.accountingPeriodId);
    await this.assertNoOverlappingActiveLock(dto);

    const item = await this.prisma.accountingLock.create({
      data: {
        ...dto,
        lockedFrom: dto.lockedFrom ? new Date(dto.lockedFrom) : undefined,
        lockedTo: dto.lockedTo ? new Date(dto.lockedTo) : undefined,
        status: 'ACTIVE',
        createdById: user.id,
      },
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

  private async assertNoOverlappingActiveLock(dto: CreateAccountingLockDto) {
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
