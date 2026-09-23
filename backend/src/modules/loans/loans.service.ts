import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { QueryLoanDto } from './dto/query-loan.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { MarkLoanStatusDto } from './dto/mark-loan-status.dto';
import { LoanLedgerService } from './loan-ledger.service';
import { LoanLifecycleService } from './loan-lifecycle.service';
import { AccessLevel, LoanStatus, Prisma } from '@prisma/client';

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly lifecycle: LoanLifecycleService,
    private readonly ledger: LoanLedgerService,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  async findAll(query: QueryLoanDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      groupId,
      status,
      obligationType,
      borrowerLevel,
      riskLevel,
      search,
      maturityBefore,
    } = query;
    const skip = (page - 1) * limit;

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.LoanWhereInput = {
      deletedAt: null,
      ...(await this.ledger.readWhere(user, companyId)),
    };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      // Non-group-scoped users see only their own companies (group-level loans require GROUP scope).
      where.companyId = { in: accessibleIds };
    }
    if (groupId) where.groupId = groupId;
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (obligationType) where.obligationType = obligationType;
    if (borrowerLevel) where.borrowerLevel = borrowerLevel;
    if (riskLevel) where.riskLevel = riskLevel;
    if (maturityBefore) where.maturityDate = { lte: new Date(maturityBefore) };
    if (search) {
      where.OR = [
        { lenderName: { contains: search, mode: 'insensitive' } },
        { loanReference: { contains: search, mode: 'insensitive' } },
        { purpose: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.loan.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          group: { select: { id: true, name: true, code: true } },
          repayments: { orderBy: { repaymentDate: 'desc' }, take: 5 },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.loan.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── Find One ──────────────────────────────────────────────────────────────

  async findOne(id: string, user?: AuthUser) {
    const record = await this.prisma.loan.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        group: { select: { id: true, name: true, code: true } },
        repayments: { orderBy: { repaymentDate: 'desc' }, include: { financialEvent: true } },
        documents: { where: { deletedAt: null } },
      },
    });
    if (!record) throw new NotFoundException('Loan not found');

    if (user) {
      await this.ledger.scope(user, record, false);
      await this.auditLogs.log({
        action: 'loan.view',
        entityType: 'Loan',
        entityId: id,
        userId: user.id,
        companyId: record.companyId ?? undefined,
        metadata: { lenderName: record.lenderName },
      });
    }
    return record;
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(dto: CreateLoanDto, user: AuthUser) {
    return this.lifecycle.create(dto, user);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  private async mutate<T>(
    id: string,
    user: AuthUser,
    work: (
      tx: Prisma.TransactionClient,
      loan: NonNullable<Awaited<ReturnType<PrismaService['loan']['findFirst']>>>,
    ) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM loans WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
      const loan = await tx.loan.findFirst({ where: { id, deletedAt: null } });
      if (!loan) throw new NotFoundException('Loan not found');
      await this.ledger.scope(user, loan);
      return work(tx, loan);
    });
  }
  async update(id: string, dto: UpdateLoanDto, user: AuthUser) {
    return this.mutate(id, user, async (tx, existing) => {
      const controlled = [
        'companyId',
        'divisionId',
        'branchId',
        'groupId',
        'borrowerLevel',
        'obligationType',
        'principalAmount',
        'outstandingBalance',
        'disbursementDate',
        'currency',
        'status',
        'bankAccountId',
        'fundingMode',
        'principalLedgerAccountId',
        'cashDeskAccountId',
        'openingOffsetAccountId',
        'recognitionDate',
        'fees',
        'feeAccountId',
        'requestId',
      ];
      for (const field of controlled) {
        const value = (dto as Record<string, unknown>)[field];
        const current = (existing as unknown as Record<string, unknown>)[field];
        const display = (v: unknown) =>
          v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
        if (value !== undefined && display(value) !== display(current))
          throw new BadRequestException(
            'Posted loan identity and balances cannot be edited. Reverse the incorrect loan event instead.',
          );
      }
      const terms = ['interestRate', 'maturityDate', 'repaymentFrequency', 'repaymentAmount'];
      if (
        terms.some((field) => (dto as Record<string, unknown>)[field] !== undefined) &&
        (await tx.loanRepaymentSchedule.count({ where: { loanDebtId: id, deletedAt: null } }))
      )
        throw new BadRequestException(
          'This loan has a schedule. Its terms require a reviewed restructuring.',
        );
      if (dto.maturityDate && new Date(dto.maturityDate) <= existing.disbursementDate)
        throw new BadRequestException('Maturity must follow disbursement.');
      const rate =
        dto.interestRate === undefined ? undefined : new Prisma.Decimal(dto.interestRate);
      if (
        rate &&
        (!rate.isFinite() || rate.lt(0) || rate.gt('99.9999') || rate.decimalPlaces() > 4)
      )
        throw new BadRequestException('Invalid annual interest rate.');
      const data: Prisma.LoanUpdateInput = {};
      for (const key of [
        'lenderName',
        'loanReference',
        'lenderType',
        'lenderContact',
        'riskLevel',
        'purpose',
        'collateralDescription',
        'linkedAssetIds',
        'guarantorName',
        'guarantorContact',
        'guaranteeDetails',
        'notes',
      ] as const) {
        if (dto[key] !== undefined) Object.assign(data, { [key]: dto[key] });
      }
      if (rate !== undefined) data.interestRate = rate;
      if (dto.maturityDate) data.maturityDate = new Date(dto.maturityDate);
      if (dto.repaymentFrequency) data.repaymentFrequency = dto.repaymentFrequency;
      if (dto.repaymentAmount !== undefined)
        data.repaymentAmount = dto.repaymentAmount ? new Prisma.Decimal(dto.repaymentAmount) : null;
      const record = await tx.loan.update({ where: { id }, data });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'loan.update',
        entityType: 'Loan',
        entityId: id,
        userId: user.id,
        companyId: record.companyId,
        oldValue: existing as any,
        newValue: record as any,
      });
      return record;
    });
  }

  // ─── Record Repayment ──────────────────────────────────────────────────────

  async recordRepayment(loanId: string, dto: RecordRepaymentDto, user: AuthUser) {
    return this.lifecycle.repay(loanId, dto, user);
  }

  // ─── Mark Status ───────────────────────────────────────────────────────────

  async markStatus(id: string, dto: MarkLoanStatusDto, user: AuthUser) {
    if (!['ACTIVE', 'DEFAULTED', 'RESTRUCTURED'].includes(dto.status))
      throw new BadRequestException(
        'Settlement and cancellation are controlled by repayments and reversals.',
      );
    return this.mutate(id, user, async (tx, existing) => {
      await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
      if (!['ACTIVE', 'DEFAULTED', 'RESTRUCTURED'].includes(existing.status))
        throw new BadRequestException('A closed loan cannot be reopened by changing its status.');
      const record = await tx.loan.update({ where: { id }, data: { status: dto.status } });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'loan.status_changed',
        entityType: 'Loan',
        entityId: id,
        userId: user.id,
        companyId: existing.companyId,
        oldValue: { status: existing.status },
        newValue: { status: dto.status },
      });
      return record;
    });
  }
  async remove(id: string, user: AuthUser) {
    return this.mutate(id, user, async (tx, existing) => {
      await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
      if (
        (await tx.loanFinancialEvent.count({ where: { loanId: id } })) ||
        (await tx.loanRepayment.count({ where: { loanId: id } })) ||
        (await tx.loanRepaymentSchedule.count({ where: { loanDebtId: id } }))
      )
        throw new BadRequestException(
          'Loans with financial or schedule history cannot be deleted. Reverse incorrect financial events instead.',
        );
      await tx.loan.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'loan.delete',
        entityType: 'Loan',
        entityId: id,
        userId: user.id,
        companyId: existing.companyId,
      });
      return { success: true };
    });
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  async getSummary(user: AuthUser) {
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const scopeFilter: Prisma.LoanWhereInput =
      accessibleIds === null ? {} : { companyId: { in: accessibleIds } };
    const baseFilter: Prisma.LoanWhereInput = {
      deletedAt: null,
      ...scopeFilter,
      ...(await this.ledger.readWhere(user)),
    };
    const activeFilter: Prisma.LoanWhereInput = {
      ...baseFilter,
      status: { in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED, LoanStatus.RESTRUCTURED] },
    };

    const [
      totalCount,
      activeCount,
      settledCount,
      defaultedCount,
      highRiskCount,
      collateralCount,
      totalPrincipal,
      totalOutstanding,
    ] = await Promise.all([
      this.prisma.loan.count({ where: baseFilter }),
      this.prisma.loan.count({ where: activeFilter }),
      this.prisma.loan.count({
        where: { ...baseFilter, status: { in: [LoanStatus.SETTLED, LoanStatus.FULLY_PAID] } },
      }),
      this.prisma.loan.count({ where: { ...baseFilter, status: LoanStatus.DEFAULTED } }),
      this.prisma.loan.count({ where: { ...baseFilter, riskLevel: { in: ['HIGH', 'CRITICAL'] } } }),
      this.prisma.loan.count({ where: { ...baseFilter, collateralDescription: { not: null } } }),
      this.prisma.loan.aggregate({ where: baseFilter, _sum: { principalAmount: true } }),
      this.prisma.loan.aggregate({ where: activeFilter, _sum: { outstandingBalance: true } }),
    ]);

    // Monthly repayment burden (sum of repaymentAmount on ACTIVE monthly loans)
    const monthlyBurden = await this.prisma.loan.aggregate({
      where: { ...activeFilter, repaymentFrequency: 'MONTHLY', repaymentAmount: { not: null } },
      _sum: { repaymentAmount: true },
    });

    // Upcoming repayments (maturity within 90 days)
    const nintyDaysOut = new Date();
    nintyDaysOut.setDate(nintyDaysOut.getDate() + 90);
    const upcomingMaturity = await this.prisma.loan.count({
      where: { ...activeFilter, maturityDate: { lte: nintyDaysOut } },
    });

    // Per-company breakdown
    const byCompanyRaw = await this.prisma.loan.groupBy({
      by: ['companyId'],
      where: activeFilter,
      _sum: { outstandingBalance: true },
      _count: { id: true },
    });

    const companyIds = byCompanyRaw.map((r) => r.companyId).filter(Boolean) as string[];
    const companies = await this.prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true, code: true },
    });

    const byCompany = byCompanyRaw.map((r) => {
      const co = companies.find((c) => c.id === r.companyId);
      return {
        companyId: r.companyId,
        companyName: co?.name ?? 'Group',
        companyCode: co?.code,
        count: r._count.id,
        totalOutstanding: r._sum.outstandingBalance,
      };
    });

    return {
      totalCount,
      activeCount,
      settledCount,
      defaultedCount,
      highRiskCount,
      collateralCount,
      upcomingMaturity,
      totalPrincipal: totalPrincipal._sum.principalAmount ?? 0,
      totalOutstandingBalance: totalOutstanding._sum.outstandingBalance ?? 0,
      monthlyRepaymentBurden: monthlyBurden._sum.repaymentAmount ?? 0,
      byCompany,
    };
  }

  // ─── Upcoming Repayments ───────────────────────────────────────────────────

  async getUpcomingRepayments(user: AuthUser, days = 30) {
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.LoanWhereInput = {
      deletedAt: null,
      status: LoanStatus.ACTIVE,
      maturityDate: { lte: this.daysFromNow(days) },
      ...(await this.ledger.readWhere(user)),
      ...(accessibleIds === null ? {} : { companyId: { in: accessibleIds } }),
    };
    return this.prisma.loan.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: { maturityDate: 'asc' },
    });
  }

  // ─── Overdue ───────────────────────────────────────────────────────────────

  async getOverdue(user: AuthUser) {
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.LoanWhereInput = {
      deletedAt: null,
      status: LoanStatus.ACTIVE,
      maturityDate: { lt: new Date() },
      ...(await this.ledger.readWhere(user)),
      ...(accessibleIds === null ? {} : { companyId: { in: accessibleIds } }),
    };
    return this.prisma.loan.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: { maturityDate: 'asc' },
    });
  }

  // ─── Audit History ────────────────────────────────────────────────────────

  async getAuditHistory(id: string, user: AuthUser) {
    // Reuse findOne to enforce company scope on the underlying loan.
    await this.findOne(id, user);
    return this.prisma.auditLog.findMany({
      where: { entityType: 'Loan', entityId: id },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private daysFromNow(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }
}
