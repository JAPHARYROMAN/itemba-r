import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { UpdateAccountingPeriodDto } from './dto/update-accounting-period.dto';
import { QueryAccountingPeriodDto } from './dto/query-accounting-period.dto';
import {
  CloseAcknowledgement,
  PartyCloseCheckService,
} from '../financial-reports/party-close-check.service';

@Injectable()
export class AccountingPeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    // Party linkage (Phase 3): optional so the existing specs keep constructing the service.
    private readonly closeCheck?: PartyCloseCheckService,
  ) {}

  async findAll(query: QueryAccountingPeriodDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, fiscalYearId, status } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.AccountingPeriodWhereInput = {};
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else {
      const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(user);
      if (accessibleCompanyIds !== null) {
        where.companyId = { in: accessibleCompanyIds };
      }
    }
    if (fiscalYearId) where.fiscalYearId = fiscalYearId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.accountingPeriod.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          fiscalYear: { select: { id: true, name: true } },
        },
        orderBy: { startDate: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.accountingPeriod.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimumAccess: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.accountingPeriod.findFirst({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        fiscalYear: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Accounting period not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimumAccess);
    return record;
  }

  async create(dto: CreateAccountingPeriodDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const fiscalYear = await this.assertFiscalYearBelongsToCompany(dto.fiscalYearId, dto.companyId);
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    await this.assertValidPeriodRange({
      companyId: dto.companyId,
      fiscalYearId: dto.fiscalYearId,
      fiscalYearStart: fiscalYear.startDate,
      fiscalYearEnd: fiscalYear.endDate,
      startDate,
      endDate,
    });

    const record = await this.prisma.accountingPeriod.create({
      data: {
        companyId: dto.companyId,
        fiscalYearId: dto.fiscalYearId,
        name: dto.name,
        startDate,
        endDate,
        status: dto.status,
      },
    });
    await this.auditLogs.log({
      action: 'ACCOUNTING_PERIOD_CREATE',
      entityType: 'AccountingPeriod',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async update(id: string, dto: UpdateAccountingPeriodDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    const fiscalYear = await this.assertFiscalYearBelongsToCompany(
      existing.fiscalYearId,
      existing.companyId,
    );
    await this.assertValidPeriodRange({
      companyId: existing.companyId,
      fiscalYearId: existing.fiscalYearId,
      fiscalYearStart: fiscalYear.startDate,
      fiscalYearEnd: fiscalYear.endDate,
      startDate,
      endDate,
      excludeId: id,
    });

    const record = await this.prisma.accountingPeriod.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.startDate && { startDate }),
        ...(dto.endDate && { endDate }),
        ...(dto.status && { status: dto.status }),
      },
    });
    await this.auditLogs.log({
      action: 'ACCOUNTING_PERIOD_UPDATE',
      entityType: 'AccountingPeriod',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return record;
  }

  async close(id: string, user: AuthUser, acknowledged?: CloseAcknowledgement) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    // Party linkage (Phase 3): the same gate and snapshot as the formal period close.
    const check = this.closeCheck
      ? await this.closeCheck.checkOrRefuse(
          existing.companyId,
          existing.endDate,
          user,
          acknowledged,
        )
      : null;
    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.accountingPeriod.update({
        where: { id },
        data: { status: 'CLOSED' },
      });
      if (check)
        await this.closeCheck!.snapshot(
          tx,
          { companyId: existing.companyId, accountingPeriodId: id, userId: user.id },
          check,
        );
      return updated;
    });
    await this.auditLogs.log({
      action: 'ACCOUNTING_PERIOD_CLOSE',
      entityType: 'AccountingPeriod',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: existing.status },
      newValue: { status: 'CLOSED' },
      ...(check ? { metadata: this.closeCheck!.auditMetadata(check, acknowledged) } : {}),
    });
    return record;
  }

  /** Party linkage (Phase 3): the check the close will apply, as of the period end. */
  async partyCheck(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    return this.requireCloseCheck().check(existing.companyId, existing.endDate, user);
  }

  /** Party linkage (Phase 3): what both sides said at the latest close of this period. */
  async partySnapshots(id: string, user: AuthUser) {
    await this.findOne(id, user);
    return this.requireCloseCheck().snapshots(id);
  }

  private requireCloseCheck() {
    if (!this.closeCheck)
      throw new BadRequestException('Control reconciliation is unavailable in this deployment.');
    return this.closeCheck;
  }

  async lock(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.accountingPeriod.update({
      where: { id },
      data: { status: 'LOCKED' },
    });
    await this.auditLogs.log({
      action: 'ACCOUNTING_PERIOD_LOCK',
      entityType: 'AccountingPeriod',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: { status: existing.status },
      newValue: { status: 'LOCKED' },
    });
    return record;
  }

  private async assertFiscalYearBelongsToCompany(fiscalYearId: string, companyId: string) {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId },
      select: { companyId: true, startDate: true, endDate: true },
    });
    if (!fiscalYear || fiscalYear.companyId !== companyId) {
      throw new BadRequestException('Fiscal year must belong to the same company');
    }
    return fiscalYear;
  }

  private async assertValidPeriodRange(input: {
    companyId: string;
    fiscalYearId: string;
    fiscalYearStart: Date;
    fiscalYearEnd: Date;
    startDate: Date;
    endDate: Date;
    excludeId?: string;
  }) {
    if (Number.isNaN(input.startDate.getTime()) || Number.isNaN(input.endDate.getTime())) {
      throw new BadRequestException('Accounting period dates are invalid');
    }
    if (input.startDate > input.endDate) {
      throw new BadRequestException('Accounting period start date cannot be after end date');
    }
    if (input.startDate < input.fiscalYearStart || input.endDate > input.fiscalYearEnd) {
      throw new BadRequestException('Accounting period must fall within the fiscal year');
    }

    const overlapping = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId: input.companyId,
        fiscalYearId: input.fiscalYearId,
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
        OR: [{ startDate: { lte: input.endDate }, endDate: { gte: input.startDate } }],
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new BadRequestException('Accounting period date range overlaps an existing period');
    }
  }
}
