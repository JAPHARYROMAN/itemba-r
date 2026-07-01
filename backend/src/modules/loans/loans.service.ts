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
import { AccessLevel, BorrowerLevel, LoanStatus, Prisma } from '@prisma/client';

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  /**
   * Resolve the cash-side ledger account for a loan disbursement/repayment.
   * A loan draws down into / is repaid from a bank account when `bankAccountId`
   * is set, so prefer the BANK role in that case; otherwise use CASH_ON_HAND.
   * BANK is resolved DEFENSIVELY: on charts that do not carry a distinct BANK
   * account we fall back to CASH_ON_HAND rather than failing the posting.
   */
  private async resolveCashSideAccount(
    companyId: string,
    hasBankAccount: boolean,
    tx: Prisma.TransactionClient,
  ) {
    if (hasBankAccount) {
      try {
        return await this.accountResolver.resolve(companyId, 'BANK', tx);
      } catch {
        // Chart has no dedicated BANK account — fall back to cash-on-hand.
      }
    }
    return this.accountResolver.resolve(companyId, 'CASH_ON_HAND', tx);
  }

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
    // Creating a loan is a mutation, so require WRITE-level access to the target
    // company (matches expenses.create / fixed-assets.create and the other
    // mutating loan methods). A user with only READ access must not create a
    // financial record scoped to that company.
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    // ITMB-105: amounts are validated as non-negative numeric strings by the DTO.
    // Enforce the cross-field invariant that the opening outstanding balance
    // cannot exceed the principal, and reject a non-positive principal.
    const principalDecimal = new Prisma.Decimal(dto.principalAmount);
    const outstandingDecimal = new Prisma.Decimal(dto.outstandingBalance);
    if (principalDecimal.lte(0)) {
      throw new BadRequestException('principalAmount must be greater than zero');
    }
    if (outstandingDecimal.gt(principalDecimal)) {
      throw new BadRequestException('outstandingBalance cannot exceed principalAmount');
    }

    const scope = await this.resolveLoanScope({
      companyId: dto.companyId,
      divisionId: dto.divisionId || null,
      branchId: dto.branchId || null,
      bankAccountId: dto.bankAccountId || null,
      borrowerLevel,
    });

    const createdById = user.id;
    const disbursementDate = new Date(dto.disbursementDate);

    // GL FIX (audit MED: "full-principal disbursement JE double-books opening
    // balances"). Only a genuinely new drawdown funded THROUGH this system moves
    // cash: DR Cash/Bank, CR Loan Principal Payable for the full principal. An
    // opening-balance / migrated loan (outstandingBalance < principalAmount) was
    // NOT disbursed here — its cash already landed (and was partly repaid) before
    // this record existed, so posting a full-principal disbursement JE would
    // double-book cash and the liability. A new drawdown is identified by an
    // outstanding balance equal to the full principal (nothing repaid yet).
    // Opening-balance loans are recognised in the ledger via a separate
    // opening-balance / trial-balance import, not through this endpoint.
    const isNewDrawdown = outstandingDecimal.equals(principalDecimal);

    // Create the loan and post the disbursement journal entry ATOMICALLY so the
    // liability cannot exist in the subledger without a matching GL swing.
    const { record, journalEntryId } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.loan.create({
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
          principalAmount: principalDecimal,
          currency: dto.currency,
          interestRate: new Prisma.Decimal(dto.interestRate),
          disbursementDate,
          maturityDate: new Date(dto.maturityDate),
          repaymentFrequency: dto.repaymentFrequency,
          repaymentAmount: dto.repaymentAmount ? new Prisma.Decimal(dto.repaymentAmount) : undefined,
          outstandingBalance: outstandingDecimal,
          // ITMB-105: status is server-controlled at creation; ignore client input.
          status: LoanStatus.ACTIVE,
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

      // GL FIX (audit: "No loan disbursement JE"). Post the drawdown so the loan
      // liability is recognised BEFORE any repayment debits it:
      //   DR  Cash/Bank                (BANK if bankAccountId else CASH_ON_HAND)
      //   CR  Loan Principal Payable   (LOAN_PRINCIPAL_PAYABLE)
      // Only company-scoped loans carry a GL (GROUP-level obligations have no
      // companyId to resolve a chart against — mirrors the schedule generator).
      // Skip for opening-balance loans (see `isNewDrawdown` above) so a migrated
      // loan does not double-book cash/liability.
      let jeId: string | null = null;
      if (created.companyId && isNewDrawdown) {
        const cashAccount = await this.resolveCashSideAccount(
          created.companyId,
          Boolean(dto.bankAccountId),
          tx,
        );
        const loanPayableAccount = await this.accountResolver.resolve(
          created.companyId,
          'LOAN_PRINCIPAL_PAYABLE',
          tx,
        );
        const journalNumber = await this.codes.next({
          entityType: 'LoanJournal',
          companyId: created.companyId,
          tx,
        });
        const description = `Loan disbursement ${created.loanReference ?? created.lenderName}`;
        const je = await this.postingEngine.postLines(
          {
            journalNumber,
            companyId: created.companyId,
            divisionId: created.divisionId,
            branchId: created.branchId,
            transactionDate: disbursementDate,
            description,
            referenceType: 'Loan',
            referenceId: created.id,
            status: 'POSTED',
            userId: createdById,
            moduleName: 'loans',
            lines: [
              {
                accountId: cashAccount.id,
                description: 'Loan proceeds received',
                debit: principalDecimal,
                credit: 0,
              },
              {
                accountId: loanPayableAccount.id,
                description: 'Loan principal payable',
                debit: 0,
                credit: principalDecimal,
              },
            ],
          },
          tx,
        );
        jeId = je.id;
      }

      return { record: created, journalEntryId: jeId };
    });

    await this.auditLogs.log({
      action: 'loan.create',
      entityType: 'Loan',
      entityId: record.id,
      userId: createdById,
      companyId: record.companyId ?? undefined,
      newValue: record as any,
      metadata: { journalEntryId },
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

    // GL FIX (audit: "Two loan repayment paths both decrement outstandingBalance").
    // If this loan is managed by an amortization schedule, the schedule path
    // (loan-repayment-schedules.recordPayment) is the single authoritative
    // repayment path: it relieves principal AND posts the JE, keyed to each
    // installment. Recording an ad-hoc repayment here as well would relieve the
    // same principal twice against the SAME Loan.outstandingBalance. Refuse so
    // one real cash event can only be booked through one path.
    const scheduleCount = await this.prisma.loanRepaymentSchedule.count({
      where: { loanDebtId: loanId, deletedAt: null },
    });
    if (scheduleCount > 0) {
      throw new BadRequestException(
        'This loan has an amortization schedule; record repayments against the schedule ' +
          'installments (loan-repayment-schedules) so principal is not relieved twice.',
      );
    }

    const actorId = user.id;
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Repayment amount must be greater than zero');

    const repayment = await this.prisma.$transaction(async (tx) => {
      // ITMB-063: lock the loan row and read the authoritative prior balance.
      const rows = await tx.$queryRaw<Array<{ outstandingBalance: Prisma.Decimal }>>`
        SELECT "outstandingBalance" FROM "loans" WHERE "id" = ${loanId} AND "deletedAt" IS NULL FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException('Loan not found');
      const priorBalance = new Prisma.Decimal(rows[0].outstandingBalance);

      // Derive the principal portion server-side (default the full amount to
      // principal when the caller does not split it out), and clamp the new
      // outstanding balance to >= 0. The client cannot set the balance directly.
      const principalPortion = dto.principal ? new Prisma.Decimal(dto.principal) : amount;
      if (principalPortion.lt(0)) {
        throw new BadRequestException('Principal portion cannot be negative');
      }
      if (principalPortion.gt(amount)) {
        throw new BadRequestException('Principal portion cannot exceed the repayment amount');
      }
      // The non-principal remainder (interest + penalties/finance charges) is
      // expensed. It is the balancing figure so the JE always ties to `amount`.
      const financeCharge = amount.minus(principalPortion);
      let newBalance = priorBalance.minus(principalPortion);
      if (newBalance.lt(0)) newBalance = new Prisma.Decimal(0);

      const repaymentDate = new Date(dto.repaymentDate);

      const created = await tx.loanRepayment.create({
        data: {
          loanId,
          repaymentDate,
          amount,
          currency: dto.currency,
          principal: dto.principal ? new Prisma.Decimal(dto.principal) : undefined,
          interest: dto.interest ? new Prisma.Decimal(dto.interest) : undefined,
          penalties: dto.penalties ? new Prisma.Decimal(dto.penalties) : undefined,
          // Record the server-derived remaining balance (not client-controlled).
          remainingBalance: newBalance,
          paymentMethod: dto.paymentMethod,
          referenceNumber: dto.referenceNumber,
          notes: dto.notes,
          recordedById: actorId,
        },
      });

      // Always update the outstanding balance from the server-side derivation.
      await tx.loan.update({
        where: { id: loanId },
        data: { outstandingBalance: newBalance },
      });

      // GL FIX: post a balanced JE for the cash repayment (mirrors the schedule
      // path's repayment posting) so the loans-module repayment path is itself
      // GL-correct:
      //   DR  Loan Principal Payable  (LOAN_PRINCIPAL_PAYABLE)   principalPortion
      //   DR  Loan Interest Expense   (LOAN_INTEREST_EXPENSE)    interest+penalties
      //   CR  Cash/Bank               (BANK|CASH_ON_HAND)        amount
      let journalEntryId: string | null = null;
      if (loan.companyId) {
        const loanPayableAccount = await this.accountResolver.resolve(
          loan.companyId,
          'LOAN_PRINCIPAL_PAYABLE',
          tx,
        );
        const cashAccount = await this.resolveCashSideAccount(
          loan.companyId,
          Boolean(loan.bankAccountId),
          tx,
        );
        const lines = [
          {
            accountId: loanPayableAccount.id,
            description: 'Principal portion',
            debit: principalPortion,
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: cashAccount.id,
            description: 'Cash paid',
            debit: new Prisma.Decimal(0),
            credit: amount,
          },
        ];
        // Only add the interest/finance-charge line when non-zero; a zero line
        // would be rejected by the posting engine.
        if (financeCharge.gt(0)) {
          const interestAccount = await this.accountResolver.resolve(
            loan.companyId,
            'LOAN_INTEREST_EXPENSE',
            tx,
          );
          lines.splice(1, 0, {
            accountId: interestAccount.id,
            description: 'Interest / finance charge portion',
            debit: financeCharge,
            credit: new Prisma.Decimal(0),
          });
        }
        const journalNumber = await this.codes.next({
          entityType: 'LoanJournal',
          companyId: loan.companyId,
          tx,
        });
        const je = await this.postingEngine.postLines(
          {
            journalNumber,
            companyId: loan.companyId,
            divisionId: loan.divisionId,
            branchId: loan.branchId,
            transactionDate: repaymentDate,
            description: `Loan repayment ${loan.loanReference ?? loan.lenderName}`,
            referenceType: 'LoanRepayment',
            referenceId: created.id,
            status: 'POSTED',
            userId: actorId,
            moduleName: 'loans',
            lines,
          },
          tx,
        );
        journalEntryId = je.id;
      }

      return { created, journalEntryId };
    });

    await this.auditLogs.log({
      action: 'loan.repayment_recorded',
      entityType: 'Loan',
      entityId: loanId,
      userId: actorId,
      companyId: loan.companyId ?? undefined,
      newValue: repayment.created as any,
      metadata: {
        amount: dto.amount,
        lenderName: loan.lenderName,
        journalEntryId: repayment.journalEntryId,
      },
    });

    return repayment.created;
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
