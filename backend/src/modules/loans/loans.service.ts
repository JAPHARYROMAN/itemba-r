import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { QueryLoanDto } from './dto/query-loan.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { MarkLoanStatusDto } from './dto/mark-loan-status.dto';
import { AccessLevel, BorrowerLevel, LoanStatus, Prisma } from '@prisma/client';

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
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
    const where: Prisma.LoanWhereInput = { deletedAt: null };
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
        repayments: { orderBy: { repaymentDate: 'desc' } },
        documents: { where: { deletedAt: null } },
      },
    });
    if (!record) throw new NotFoundException('Loan not found');

    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
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
    const borrowerLevel = dto.borrowerLevel ?? BorrowerLevel.COMPANY;
    if (borrowerLevel === BorrowerLevel.COMPANY && !dto.companyId) {
      throw new BadRequestException('companyId is required when borrowerLevel is COMPANY');
    }
    if (borrowerLevel === BorrowerLevel.GROUP && !dto.groupId) {
      throw new BadRequestException('groupId is required when borrowerLevel is GROUP');
    }
    await this.companyScope.assertCanAccessCompany(user, dto.companyId);
    const scope = await this.resolveLoanScope({
      companyId: dto.companyId,
      divisionId: dto.divisionId || null,
      branchId: dto.branchId || null,
      bankAccountId: dto.bankAccountId || null,
      borrowerLevel,
    });

    const createdById = user.id;
    const record = await this.prisma.loan.create({
      data: {
        obligationType: dto.obligationType,
        borrowerLevel,
        companyId: dto.companyId,
        divisionId: scope.divisionId,
        branchId: scope.branchId,
        groupId: dto.groupId,
        loanReference: dto.loanReference,
        lenderName: dto.lenderName,
        lenderType: dto.lenderType,
        lenderContact: dto.lenderContact,
        principalAmount: new Prisma.Decimal(dto.principalAmount),
        currency: dto.currency,
        interestRate: new Prisma.Decimal(dto.interestRate),
        disbursementDate: new Date(dto.disbursementDate),
        maturityDate: new Date(dto.maturityDate),
        repaymentFrequency: dto.repaymentFrequency,
        repaymentAmount: dto.repaymentAmount ? new Prisma.Decimal(dto.repaymentAmount) : undefined,
        outstandingBalance: new Prisma.Decimal(dto.outstandingBalance),
        status: dto.status,
        riskLevel: dto.riskLevel,
        purpose: dto.purpose,
        collateralDescription: dto.collateralDescription,
        linkedAssetIds: dto.linkedAssetIds ?? [],
        guarantorName: dto.guarantorName,
        guarantorContact: dto.guarantorContact,
        guaranteeDetails: dto.guaranteeDetails,
        bankAccountId: dto.bankAccountId,
        notes: dto.notes,
        createdById,
      },
    });

    await this.auditLogs.log({
      action: 'loan.create',
      entityType: 'Loan',
      entityId: record.id,
      userId: createdById,
      companyId: record.companyId ?? undefined,
      newValue: record as any,
    });

    return record;
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateLoanDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const actorId = user.id;
    const scope = await this.resolveLoanScope({
      companyId: dto.companyId !== undefined ? dto.companyId : existing.companyId,
      divisionId:
        dto.divisionId !== undefined ? dto.divisionId || null : existing.divisionId || null,
      branchId: dto.branchId !== undefined ? dto.branchId || null : existing.branchId || null,
      bankAccountId:
        dto.bankAccountId !== undefined
          ? dto.bankAccountId || null
          : existing.bankAccountId || null,
      borrowerLevel: dto.borrowerLevel ?? existing.borrowerLevel,
    });
    const record = await this.prisma.loan.update({
      where: { id },
      data: {
        divisionId: scope.divisionId,
        branchId: scope.branchId,
        ...(dto.obligationType && { obligationType: dto.obligationType }),
        ...(dto.lenderName && { lenderName: dto.lenderName }),
        ...(dto.lenderType !== undefined && { lenderType: dto.lenderType }),
        ...(dto.lenderContact !== undefined && { lenderContact: dto.lenderContact }),
        ...(dto.principalAmount && { principalAmount: new Prisma.Decimal(dto.principalAmount) }),
        ...(dto.interestRate && { interestRate: new Prisma.Decimal(dto.interestRate) }),
        ...(dto.disbursementDate && { disbursementDate: new Date(dto.disbursementDate) }),
        ...(dto.maturityDate && { maturityDate: new Date(dto.maturityDate) }),
        ...(dto.repaymentFrequency && { repaymentFrequency: dto.repaymentFrequency }),
        ...(dto.repaymentAmount !== undefined && {
          repaymentAmount: dto.repaymentAmount ? new Prisma.Decimal(dto.repaymentAmount) : null,
        }),
        ...(dto.outstandingBalance && {
          outstandingBalance: new Prisma.Decimal(dto.outstandingBalance),
        }),
        ...(dto.status && { status: dto.status }),
        ...(dto.riskLevel && { riskLevel: dto.riskLevel }),
        ...(dto.purpose !== undefined && { purpose: dto.purpose }),
        ...(dto.collateralDescription !== undefined && {
          collateralDescription: dto.collateralDescription,
        }),
        ...(dto.linkedAssetIds && { linkedAssetIds: dto.linkedAssetIds }),
        ...(dto.guarantorName !== undefined && { guarantorName: dto.guarantorName }),
        ...(dto.guarantorContact !== undefined && { guarantorContact: dto.guarantorContact }),
        ...(dto.guaranteeDetails !== undefined && { guaranteeDetails: dto.guaranteeDetails }),
        ...(dto.bankAccountId !== undefined && { bankAccountId: dto.bankAccountId || null }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    await this.auditLogs.log({
      action: 'loan.update',
      entityType: 'Loan',
      entityId: id,
      userId: actorId,
      companyId: record.companyId ?? undefined,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  // ─── Record Repayment ──────────────────────────────────────────────────────

  async recordRepayment(loanId: string, dto: RecordRepaymentDto, user: AuthUser) {
    const loan = await this.findOne(loanId);
    await this.companyScope.assertCanAccessCompany(user, loan.companyId, AccessLevel.WRITE);
    if (loan.status === LoanStatus.SETTLED || loan.status === LoanStatus.FULLY_PAID) {
      throw new BadRequestException('Cannot record repayment on a settled loan');
    }
    const actorId = user.id;
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Repayment amount must be greater than zero');

    const repayment = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "loans" WHERE "id" = ${loanId} AND "deletedAt" IS NULL FOR UPDATE`;
      const created = await tx.loanRepayment.create({
        data: {
          loanId,
          repaymentDate: new Date(dto.repaymentDate),
          amount,
          currency: dto.currency,
          principal: dto.principal ? new Prisma.Decimal(dto.principal) : undefined,
          interest: dto.interest ? new Prisma.Decimal(dto.interest) : undefined,
          penalties: dto.penalties ? new Prisma.Decimal(dto.penalties) : undefined,
          remainingBalance: dto.remainingBalance
            ? new Prisma.Decimal(dto.remainingBalance)
            : undefined,
          paymentMethod: dto.paymentMethod,
          referenceNumber: dto.referenceNumber,
          notes: dto.notes,
          recordedById: actorId,
        },
      });

      if (dto.remainingBalance !== undefined) {
        await tx.loan.update({
          where: { id: loanId },
          data: { outstandingBalance: new Prisma.Decimal(dto.remainingBalance) },
        });
      }

      return created;
    });

    await this.auditLogs.log({
      action: 'loan.repayment_recorded',
      entityType: 'Loan',
      entityId: loanId,
      userId: actorId,
      companyId: loan.companyId ?? undefined,
      newValue: repayment as any,
      metadata: { amount: dto.amount, lenderName: loan.lenderName },
    });

    return repayment;
  }

  // ─── Mark Status ───────────────────────────────────────────────────────────

  async markStatus(id: string, dto: MarkLoanStatusDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const actorId = user.id;
    const record = await this.prisma.loan.update({
      where: { id },
      data: { status: dto.status },
    });

    await this.auditLogs.log({
      action: `loan.status_changed.${dto.status.toLowerCase()}`,
      entityType: 'Loan',
      entityId: id,
      userId: actorId,
      companyId: record.companyId ?? undefined,
      oldValue: { status: existing.status },
      newValue: { status: dto.status },
      metadata: { lenderName: existing.lenderName },
    });

    return record;
  }

  // ─── Soft Delete ───────────────────────────────────────────────────────────

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const actorId = user.id;
    await this.prisma.loan.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'loan.delete',
      entityType: 'Loan',
      entityId: id,
      userId: actorId,
      companyId: existing.companyId ?? undefined,
      oldValue: existing as any,
    });

    return { success: true };
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  async getSummary(user: AuthUser) {
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const scopeFilter: Prisma.LoanWhereInput =
      accessibleIds === null ? {} : { companyId: { in: accessibleIds } };
    const baseFilter: Prisma.LoanWhereInput = { deletedAt: null, ...scopeFilter };
    const activeFilter: Prisma.LoanWhereInput = { ...baseFilter, status: LoanStatus.ACTIVE };

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

  private async resolveLoanScope(input: {
    companyId?: string | null;
    divisionId?: string | null;
    branchId?: string | null;
    bankAccountId?: string | null;
    borrowerLevel?: BorrowerLevel;
  }) {
    let divisionId = input.divisionId || null;
    let branchId = input.branchId || null;

    if (input.borrowerLevel === BorrowerLevel.GROUP) {
      return { divisionId: null, branchId: null };
    }

    if (input.bankAccountId) {
      const bankAccount = await this.prisma.bankAccount.findFirst({
        where: { id: input.bankAccountId, deletedAt: null },
        select: { companyId: true, divisionId: true, branchId: true },
      });
      if (!bankAccount) throw new BadRequestException('Bank account not found');
      if (input.companyId && bankAccount.companyId && bankAccount.companyId !== input.companyId) {
        throw new BadRequestException('Bank account does not belong to this company');
      }
      if (!divisionId && bankAccount.divisionId) divisionId = bankAccount.divisionId;
      if (!branchId && bankAccount.branchId) branchId = bankAccount.branchId;
      if (divisionId && bankAccount.divisionId && bankAccount.divisionId !== divisionId) {
        throw new BadRequestException('Bank account does not belong to the selected division');
      }
      if (branchId && bankAccount.branchId && bankAccount.branchId !== branchId) {
        throw new BadRequestException(
          'Bank account does not belong to the selected branch/location',
        );
      }
    }

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, deletedAt: null },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || (input.companyId && branch.division.companyId !== input.companyId)) {
        throw new BadRequestException('Branch/location does not belong to this company');
      }
      if (!divisionId) divisionId = branch.divisionId;
      if (divisionId && branch.divisionId !== divisionId) {
        throw new BadRequestException('Branch/location does not belong to the selected division');
      }
    }

    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || (input.companyId && division.companyId !== input.companyId)) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    return { divisionId, branchId };
  }
}
