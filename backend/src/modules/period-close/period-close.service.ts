import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { pagination } from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class PeriodCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { companyId, page = 1, limit = 20 } = query;
    const paging = pagination({ page, limit });
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    const [items, total] = await Promise.all([
      this.prisma.accountingPeriodClose.findMany({
        where,
        skip: paging.skip,
        take: paging.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.accountingPeriodClose.count({ where }),
    ]);
    return { items, total, page: paging.page, limit: paging.limit };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.accountingPeriodClose.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Period close not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertCloseScope(dto.companyId, dto.fiscalYearId, dto.accountingPeriodId);
    const existing = await this.prisma.accountingPeriodClose.findFirst({
      where: {
        companyId: dto.companyId,
        fiscalYearId: dto.fiscalYearId,
        accountingPeriodId: dto.accountingPeriodId,
        deletedAt: null,
        status: { in: ['DRAFT', 'REVIEWING', 'CLOSED'] },
      },
    });
    if (existing) {
      throw new BadRequestException('A period close already exists for this accounting period');
    }

    const item = await this.prisma.accountingPeriodClose.create({
      data: { ...dto, status: 'DRAFT', createdById: user.id },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'AccountingPeriodClose',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
    });
    return item;
  }

  async close(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status === 'CLOSED') throw new BadRequestException('Period already closed');
    await this.assertNoDraftJournals(existing.companyId, existing.accountingPeriodId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const close = await tx.accountingPeriodClose.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date(), closedById: user.id },
      });
      await tx.accountingPeriod.update({
        where: { id: existing.accountingPeriodId },
        data: { status: 'CLOSED' },
      });
      await this.ensurePeriodLock(tx, existing, user.id);
      return close;
    });
    await this.auditLogs.log({
      action: 'CLOSE',
      entityType: 'AccountingPeriodClose',
      entityId: id,
      userId: user.id,
    });
    return updated;
  }

  async reopen(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'CLOSED') throw new BadRequestException('Period is not closed');
    const updated = await this.prisma.$transaction(async (tx) => {
      const close = await tx.accountingPeriodClose.update({
        where: { id },
        data: { status: 'REOPENED' as any, reopenedById: user.id, reopenedAt: new Date() },
      });
      await tx.accountingPeriod.update({
        where: { id: existing.accountingPeriodId },
        data: { status: 'OPEN' },
      });
      await tx.accountingLock.updateMany({
        where: {
          companyId: existing.companyId,
          accountingPeriodId: existing.accountingPeriodId,
          lockType: 'PERIOD_LOCK',
          status: 'ACTIVE',
          deletedAt: null,
        },
        data: { status: 'RELEASED', releasedById: user.id, releasedAt: new Date() },
      });
      return close;
    });
    await this.auditLogs.log({
      action: 'REOPEN',
      entityType: 'AccountingPeriodClose',
      entityId: id,
      userId: user.id,
    });
    return updated;
  }

  private async assertCloseScope(
    companyId: string,
    fiscalYearId: string,
    accountingPeriodId: string,
  ) {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: { id: accountingPeriodId },
      select: { companyId: true, fiscalYearId: true },
    });
    if (!period || period.companyId !== companyId || period.fiscalYearId !== fiscalYearId) {
      throw new BadRequestException(
        'Accounting period must belong to the requested company and fiscal year',
      );
    }
  }

  private async assertNoDraftJournals(companyId: string, accountingPeriodId: string) {
    const draftCount = await this.prisma.journalEntry.count({
      where: { companyId, accountingPeriodId, status: 'DRAFT', deletedAt: null },
    });
    if (draftCount > 0) {
      throw new BadRequestException('Cannot close an accounting period with draft journal entries');
    }
  }

  private async ensurePeriodLock(
    tx: any,
    close: {
      companyId: string;
      fiscalYearId: string;
      accountingPeriodId: string;
      closeNumber: string;
    },
    userId: string,
  ) {
    const existingLock = await tx.accountingLock.findFirst({
      where: {
        companyId: close.companyId,
        accountingPeriodId: close.accountingPeriodId,
        lockType: 'PERIOD_LOCK',
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingLock) return;

    await tx.accountingLock.create({
      data: {
        lockCode: `LOCK-${close.closeNumber}`,
        companyId: close.companyId,
        lockType: 'PERIOD_LOCK',
        fiscalYearId: close.fiscalYearId,
        accountingPeriodId: close.accountingPeriodId,
        moduleName: 'accounting',
        reason: `Period closed by ${close.closeNumber}`,
        status: 'ACTIVE',
        createdById: userId,
      },
    });
  }
}
