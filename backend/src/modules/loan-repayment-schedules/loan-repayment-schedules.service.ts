import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Loan repayment scheduling and payment posting.
 *
 * Schedule generation: given a Loan (principal, annualInterestRate,
 * disbursement/maturity dates, repaymentFrequency), produce an
 * `installmentNumber`-ordered set of LoanRepaymentSchedule rows using the
 * standard French amortization formula:
 *   `EMI = P × r × (1+r)^n / ((1+r)^n - 1)`,
 * where r = the *periodic* rate (annualRate ÷ periods-per-year) and n = the
 * number of repayment periods over the loan tenure. The periodic rate and the
 * due-date step both follow `loan.repaymentFrequency` (MONTHLY / QUARTERLY /
 * SEMI_ANNUALLY / ANNUALLY), and BULLET/OTHER collapse to a single balloon
 * installment due at maturity with interest accrued over the whole tenure.
 *
 * On `recordPayment`, the payment is split into principal/interest based on
 * the schedule row, the loan's outstanding balance is reduced, and a
 * balanced journal entry is generated:
 *   DR  Loan Principal Payable  (LOAN_PRINCIPAL_PAYABLE)        principalPortion
 *   DR  Interest Expense        (LOAN_INTEREST_EXPENSE)         interestPortion
 *   CR  Cash on Hand            (CASH_ON_HAND)                  total
 */
@Injectable()
export class LoanRepaymentSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accountingControl: AccountingControlService,
    private readonly accountResolver: AccountResolverService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly postingEngine: PostingEngineService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, loanId, status, page = 1, limit = 50 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (loanId) where.loanDebtId = loanId;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.loanRepaymentSchedule.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: [{ loanDebtId: 'asc' }, { installmentNumber: 'asc' }],
      }),
      this.prisma.loanRepaymentSchedule.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.loanRepaymentSchedule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Loan repayment schedule not found');
    return item;
  }

  async create(dto: any, user: AuthUser) {
    // ITMB-026: the parent loan is the source of truth for tenant scoping.
    // Never trust a client-supplied companyId/loanDebtId on a financial row.
    const loanId = dto?.loanDebtId ?? dto?.loanId;
    if (!loanId || typeof loanId !== 'string') {
      throw new BadRequestException('loanDebtId is required');
    }
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, deletedAt: null },
      select: { id: true, companyId: true },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    if (!loan.companyId) {
      throw new BadRequestException('Loan without a companyId cannot have a repayment schedule');
    }
    await this.companyScope.assertCanAccessCompany(user, loan.companyId, AccessLevel.WRITE);

    // Strip client-controlled scoping fields; derive them from the loan.
    const {
      companyId: _companyId,
      loanDebtId: _loanDebtId,
      loanId: _loanId,
      createdById: _createdById,
      ...rest
    } = dto ?? {};
    const item = await this.prisma.loanRepaymentSchedule.create({
      data: {
        ...rest,
        companyId: loan.companyId,
        loanDebtId: loan.id,
      },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'LoanRepaymentSchedule',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
    });
    return item;
  }

  /**
   * Generate the full amortization schedule for a loan using French amortization.
   *
   * Idempotent: refuses if the loan already has a schedule (must explicitly
   * request regeneration which would invalidate posted history).
   */
  async generateForLoan(loanId: string, user: any) {
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, deletedAt: null },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    if (!loan.companyId) {
      throw new BadRequestException(
        'Loans without a companyId cannot have an auto-generated schedule',
      );
    }
    await this.companyScope.assertCanAccessCompany(user, loan.companyId, AccessLevel.WRITE);

    const existing = await this.prisma.loanRepaymentSchedule.count({
      where: { loanDebtId: loanId, deletedAt: null },
    });
    if (existing > 0) {
      throw new BadRequestException(
        `Loan already has ${existing} scheduled installments. Delete them before regenerating.`,
      );
    }

    const principal = Number(loan.principalAmount);
    const annualRate = Number(loan.interestRate);
    // Honor the loan's repayment cadence: the number of installments, the
    // periodic interest rate and the due-date step must all follow
    // repaymentFrequency, not a hard-coded month.
    const profile = this.frequencyProfile(loan.repaymentFrequency);
    const periodCount = this.computePeriodCount(loan.disbursementDate, loan.maturityDate, profile);
    if (periodCount <= 0) {
      throw new BadRequestException('Loan maturityDate must be after disbursementDate');
    }
    // For a single-balloon (BULLET/OTHER) schedule, interest accrues over the
    // whole tenure, not a fixed 12 months, so scale the annual rate by the
    // actual tenure in years. Regular cadences use the flat periodic rate.
    const periodicRate =
      profile.monthsPerPeriod > 0
        ? annualRate / profile.periodsPerYear
        : annualRate * (this.tenureMonths(loan.disbursementDate, loan.maturityDate) / 12);
    const installments = this.amortize(principal, periodicRate, periodCount);

    const companyId = loan.companyId;
    const created = await this.prisma.$transaction(async (tx) => {
      const rows = installments.map((row, idx) => {
        // Regular cadences step from the disbursement date; a single-period
        // (BULLET/OTHER) schedule falls due on the maturity date itself.
        const dueDate =
          profile.monthsPerPeriod > 0
            ? profile.advance(loan.disbursementDate, idx + 1)
            : new Date(loan.maturityDate);
        const total = row.principal + row.interest;
        return tx.loanRepaymentSchedule.create({
          data: {
            repaymentScheduleNumber: `LRS-${loanId.slice(-6)}-${String(idx + 1).padStart(3, '0')}`,
            companyId,
            loanDebtId: loanId,
            installmentNumber: idx + 1,
            dueDate,
            principalAmount: row.principal,
            interestAmount: row.interest,
            feeAmount: 0,
            totalAmount: total,
            outstandingAmount: total,
            status: 'UPCOMING',
          },
        });
      });
      return Promise.all(rows);
    });

    await this.auditLogs.log({
      action: 'GENERATE',
      entityType: 'LoanRepaymentSchedule',
      entityId: loanId,
      userId: user.id,
      companyId,
      metadata: {
        installments: created.length,
        periodCount,
        repaymentFrequency: loan.repaymentFrequency,
      },
    });

    // Return the exact created identities as well as the legacy count. The IDs
    // let governed callers bind every additive row to recovery/audit evidence
    // without a racy follow-up query; existing clients that only read
    // `installments` remain compatible.
    return { installments: created.length, scheduleIds: created.map((row) => row.id) };
  }

  async getPayments(scheduleId: string) {
    return this.prisma.loanRepaymentPayment.findMany({
      where: { loanRepaymentScheduleId: scheduleId },
      orderBy: { paymentDate: 'asc' },
    });
  }

  /**
   * Record a payment against a scheduled installment, generate the JE,
   * advance the schedule and the parent loan's outstanding balance, and
   * mark the schedule PAID / PARTIALLY_PAID accordingly.
   */
  async recordPayment(scheduleId: string, dto: any, user: AuthUser) {
    // ITMB-026: load the schedule and assert the caller can write to its company.
    const scheduleMeta = await this.findOne(scheduleId);
    await this.companyScope.assertCanAccessCompany(user, scheduleMeta.companyId, AccessLevel.WRITE);

    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('amount must be positive');

    const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    await this.accountingControl.assertPostingAllowed({
      companyId: scheduleMeta.companyId,
      transactionDate: paymentDate,
      moduleName: 'loan_repayment',
    });

    const companyId = scheduleMeta.companyId;

    const { result, principalPortion, interestPortion } = await this.prisma.$transaction(
      async (tx) => {
        // ITMB-062: serialize all payments for this loan by taking a row lock on
        // the parent loan first (the "loans" table is the verified lock target,
        // matching the loans module). Every payment against any installment of
        // the loan must acquire this lock, so concurrent payments cannot race.
        await tx.$queryRaw`SELECT "id" FROM "loans" WHERE "id" = ${scheduleMeta.loanDebtId} AND "deletedAt" IS NULL FOR UPDATE`;

        // Re-read the schedule inside the transaction (after the lock) so the
        // outstanding/paid amounts and arithmetic use authoritative values.
        const locked = await tx.loanRepaymentSchedule.findFirst({
          where: { id: scheduleId, deletedAt: null },
        });
        if (!locked) {
          throw new NotFoundException('Loan repayment schedule not found');
        }
        const outstanding = Number(locked.outstandingAmount);
        if (amount > outstanding + 0.01) {
          throw new BadRequestException(
            `Payment amount ${amount} exceeds outstanding ${outstanding}`,
          );
        }

        // Allocate this payment proportionally between scheduled principal and interest.
        const totalScheduled = Number(locked.principalAmount) + Number(locked.interestAmount);
        const principalPortion =
          totalScheduled > 0 ? (amount * Number(locked.principalAmount)) / totalScheduled : amount;
        const interestPortion = amount - principalPortion;

        const principalAccount = await this.accountResolver.resolve(
          companyId,
          'LOAN_PRINCIPAL_PAYABLE',
          tx,
        );
        const interestAccount = await this.accountResolver.resolve(
          companyId,
          'LOAN_INTEREST_EXPENSE',
          tx,
        );
        const cashAccount = await this.accountResolver.resolve(companyId, 'CASH_ON_HAND', tx);

        const journalNumber = await this.codes.next({
          entityType: 'LoanJournal',
          companyId,
          tx,
        });
        const je = await this.postingEngine.postLines(
          {
            journalNumber,
            companyId,
            transactionDate: paymentDate,
            description: `Loan repayment installment #${locked.installmentNumber}`,
            referenceType: 'LoanRepaymentSchedule',
            referenceId: scheduleId,
            status: 'POSTED',
            userId: user.id,
            moduleName: 'loan_repayment',
            lines: [
              {
                accountId: principalAccount.id,
                description: 'Principal portion',
                debit: principalPortion,
                credit: 0,
              },
              {
                accountId: interestAccount.id,
                description: 'Interest portion',
                debit: interestPortion,
                credit: 0,
              },
              {
                accountId: cashAccount.id,
                description: 'Cash paid',
                debit: 0,
                credit: amount,
              },
            ],
          },
          tx,
        );

        const repaymentPaymentNumber = await this.codes.next({
          entityType: 'LoanRepaymentPayment',
          companyId,
          tx,
        });
        const payment = await tx.loanRepaymentPayment.create({
          data: {
            repaymentPaymentNumber,
            companyId,
            loanRepaymentScheduleId: scheduleId,
            paymentDate,
            amount,
            currency: dto.currency ?? 'TZS',
            paymentMethod: dto.paymentMethod ?? 'BANK_TRANSFER',
            cashAccountId: dto.cashAccountId,
            reference: dto.reference,
            journalEntryId: je.id,
            paidById: user.id,
          },
        });

        const newPaid = Number(locked.paidAmount) + amount;
        const newOutstanding = Math.max(0, outstanding - amount);
        const newStatus: 'PAID' | 'PARTIALLY_PAID' =
          newOutstanding === 0 ? 'PAID' : 'PARTIALLY_PAID';
        await tx.loanRepaymentSchedule.update({
          where: { id: scheduleId },
          data: {
            paidAmount: newPaid,
            outstandingAmount: newOutstanding,
            status: newStatus,
            journalEntryId: je.id,
          },
        });

        // Decrement principal on the parent loan (row already locked above).
        await tx.loan.update({
          where: { id: locked.loanDebtId },
          data: { outstandingBalance: { decrement: new Prisma.Decimal(principalPortion) } },
        });

        return { result: payment, principalPortion, interestPortion };
      },
    );

    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'LoanRepaymentPayment',
      entityId: result.id,
      userId: user.id,
      companyId,
      metadata: { amount, principalPortion, interestPortion, scheduleId },
    });
    return result;
  }

  // ─── Math helpers ────────────────────────────────────────────────────────

  /**
   * French amortization: returns an array of {principal, interest} per period.
   * `periodicRate` is the interest rate *for one repayment period* (e.g.
   * annualRate/12 monthly, annualRate/4 quarterly) — the caller derives it from
   * the loan's repayment frequency, so this method is cadence-agnostic.
   * Uses `EMI = P × r × (1+r)^n / ((1+r)^n - 1)`. Falls back to flat principal
   * split when r ≈ 0 to avoid divide-by-zero.
   */
  private amortize(
    principal: number,
    periodicRate: number,
    n: number,
  ): Array<{ principal: number; interest: number }> {
    const rounded = (x: number) => Math.round(x * 100) / 100;
    if (periodicRate < 1e-9) {
      const equal = rounded(principal / n);
      const result: Array<{ principal: number; interest: number }> = [];
      let remaining = principal;
      for (let i = 0; i < n; i++) {
        const principalPart = i === n - 1 ? rounded(remaining) : equal;
        result.push({ principal: principalPart, interest: 0 });
        remaining -= principalPart;
      }
      return result;
    }
    const factor = Math.pow(1 + periodicRate, n);
    const emi = (principal * periodicRate * factor) / (factor - 1);
    let remaining = principal;
    const result: Array<{ principal: number; interest: number }> = [];
    for (let i = 0; i < n; i++) {
      const interest = remaining * periodicRate;
      let principalPart = emi - interest;
      // Final installment absorbs rounding drift.
      if (i === n - 1) principalPart = remaining;
      result.push({ principal: rounded(principalPart), interest: rounded(interest) });
      remaining -= principalPart;
    }
    return result;
  }

  /**
   * Describe a repayment cadence: how many periods fall in a year (used both to
   * split the annual rate into a periodic rate and to convert the loan tenure
   * into an installment count) and how to advance a due date by whole periods.
   *
   * Enum values come from Prisma `RepaymentFrequency`
   * (MONTHLY | QUARTERLY | SEMI_ANNUALLY | ANNUALLY | BULLET | OTHER).
   * BULLET (single balloon repayment at maturity) and any unknown/OTHER value
   * fall back to a single period so a schedule is still produced.
   */
  private frequencyProfile(frequency: string): {
    periodsPerYear: number;
    monthsPerPeriod: number;
    advance: (date: Date, periods: number) => Date;
  } {
    switch (frequency) {
      case 'QUARTERLY':
        return {
          periodsPerYear: 4,
          monthsPerPeriod: 3,
          advance: (date, periods) => this.addMonths(date, periods * 3),
        };
      case 'SEMI_ANNUALLY':
        return {
          periodsPerYear: 2,
          monthsPerPeriod: 6,
          advance: (date, periods) => this.addMonths(date, periods * 6),
        };
      case 'ANNUALLY':
        return {
          periodsPerYear: 1,
          monthsPerPeriod: 12,
          advance: (date, periods) => this.addMonths(date, periods * 12),
        };
      case 'MONTHLY':
        return {
          periodsPerYear: 12,
          monthsPerPeriod: 1,
          advance: (date, periods) => this.addMonths(date, periods),
        };
      case 'BULLET':
      case 'OTHER':
      default:
        // Single lump-sum repayment at maturity: one period spanning the whole
        // tenure. periodsPerYear=1 gives a full-tenure interest accrual and the
        // one due date lands on the maturity date (see computePeriodCount → 1).
        return {
          periodsPerYear: 1,
          monthsPerPeriod: 0,
          advance: (date, periods) => this.addMonths(date, periods),
        };
    }
  }

  /**
   * Number of whole repayment periods between disbursement and maturity for the
   * given cadence. BULLET/OTHER (monthsPerPeriod=0) collapse to a single period.
   */
  private computePeriodCount(start: Date, end: Date, profile: { monthsPerPeriod: number }): number {
    const months = this.tenureMonths(start, end);
    if (months <= 0) return 0;
    if (profile.monthsPerPeriod <= 0) return 1; // BULLET / OTHER → single balloon
    return Math.max(1, Math.round(months / profile.monthsPerPeriod));
  }

  /** Whole calendar months between two dates (>= 0). */
  private tenureMonths(start: Date, end: Date): number {
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  }

  private addMonths(date: Date, n: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + n);
    return d;
  }
}
