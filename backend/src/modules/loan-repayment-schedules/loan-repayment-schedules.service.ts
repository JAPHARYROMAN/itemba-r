import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { LoanLifecycleService } from '../loans/loan-lifecycle.service';
import { LoanLedgerService } from '../loans/loan-ledger.service';
import { loanMoney, loanDate } from '../loans/loan-allocation';
import { RecordLoanRepaymentDto } from './dto/loan-repayment-schedule-mutation.dto';
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
 * Payments use the shared lifecycle: reviewed remaining principal, interest and fees,
 * the selected mapped cash account, a balanced journal and a reversible event,
 * committed together. See LoanLifecycleService.
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
    private readonly lifecycle: LoanLifecycleService,
    private readonly loanLedger: LoanLedgerService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, loanId, status, page = 1, limit = 50 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (user) {
      const visible = await this.prisma.loan.findMany({
        where: {
          deletedAt: null,
          ...(await this.loanLedger.readWhere(user, companyId)),
          ...(loanId ? { id: loanId } : {}),
        },
        select: { id: true },
      });
      where.loanDebtId = { in: visible.map((loan) => loan.id) };
    } else if (loanId) where.loanDebtId = loanId;
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

  async findOne(id: string, user?: AuthUser) {
    const item = await this.prisma.loanRepaymentSchedule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Loan repayment schedule not found');
    if (user) {
      const loan = await this.prisma.loan.findFirst({
        where: { id: item.loanDebtId, deletedAt: null },
      });
      if (!loan) throw new NotFoundException('Loan not found');
      await this.loanLedger.scope(user, loan, false);
    }
    return item;
  }

  async create(dto: any, user: AuthUser) {
    const loanId = dto.loanDebtId || dto.loanId;
    if (!loanId) throw new BadRequestException('loanDebtId is required');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM loans WHERE id = ${loanId} FOR UPDATE`;
      const loan = await tx.loan.findFirst({ where: { id: loanId, deletedAt: null } });
      if (!loan) throw new NotFoundException('Loan not found');
      await this.loanLedger.scope(user, loan);
      if (!['ACTIVE', 'RESTRUCTURED', 'DEFAULTED'].includes(loan.status))
        throw new BadRequestException('This loan is not active.');
      if (
        (await tx.loanFinancialEvent.count({
          where: { loanId, kind: 'REPAYMENT', reversedAt: null },
        })) ||
        (await tx.loanRepayment.count({ where: { loanId, financialEvent: null } }))
      )
        throw new BadRequestException('Cannot change the schedule after repayments.');
      const principal = loanMoney(dto.principalAmount, 'Principal'),
        interest = loanMoney(dto.interestAmount, 'Interest'),
        fees = loanMoney(dto.feeAmount, 'Fees');
      const total = principal.plus(interest).plus(fees);
      const opening = await tx.loanFinancialEvent.findFirst({
        where: { loanId, kind: { in: ['OPENING', 'DISBURSEMENT'] }, reversedAt: null },
      });
      if (!opening)
        throw new BadRequestException('Recognize the loan before creating installments.');
      const dueDate = loanDate(dto.dueDate.slice(0, 10));
      if (
        total.lte(0) ||
        !Number.isInteger(dto.installmentNumber) ||
        dto.installmentNumber < 1 ||
        dueDate < opening.businessDate ||
        dueDate > loan.maturityDate
      )
        throw new BadRequestException(
          'Enter a positive installment with a valid due date within the loan term.',
        );
      const prior = await tx.loanRepaymentSchedule.findFirst({
        where: {
          repaymentScheduleNumber: dto.repaymentScheduleNumber,
          loanDebtId: loanId,
          deletedAt: null,
        },
      });
      if (prior) {
        if (
          prior.installmentNumber !== dto.installmentNumber ||
          prior.dueDate.getTime() !== dueDate.getTime() ||
          !prior.principalAmount.eq(principal) ||
          !prior.interestAmount.eq(interest) ||
          !prior.feeAmount.eq(fees)
        )
          throw new BadRequestException(
            'This installment reference was used for different details.',
          );
        return prior;
      }
      if (
        await tx.loanRepaymentSchedule.count({
          where: { loanDebtId: loanId, installmentNumber: dto.installmentNumber, deletedAt: null },
        })
      )
        throw new BadRequestException('This installment number already exists.');
      const planned = await tx.loanRepaymentSchedule.aggregate({
        where: { loanDebtId: loanId, deletedAt: null },
        _sum: { principalAmount: true },
      });
      if (
        (planned._sum.principalAmount || new Prisma.Decimal(0))
          .plus(principal)
          .gt(loan.outstandingBalance)
      )
        throw new BadRequestException('Scheduled principal exceeds the loan balance.');
      const item = await tx.loanRepaymentSchedule.create({
        data: {
          companyId: loan.companyId!,
          loanDebtId: loanId,
          repaymentScheduleNumber: dto.repaymentScheduleNumber,
          installmentNumber: dto.installmentNumber,
          dueDate,
          principalAmount: principal,
          interestAmount: interest,
          feeAmount: fees,
          totalAmount: total,
          paidAmount: 0,
          outstandingAmount: total,
          status: 'UPCOMING',
        },
      });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'CREATE',
        entityType: 'LoanRepaymentSchedule',
        entityId: item.id,
        userId: user.id,
        companyId: item.companyId,
      });
      return item;
    });
  }

  /**
   * Generate the full amortization schedule for a loan using French amortization.
   *
   * Idempotent: refuses if the loan already has a schedule (must explicitly
   * request regeneration which would invalidate posted history).
   */
  async generateForLoan(loanId: string, user: AuthUser) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM loans WHERE id = ${loanId} FOR UPDATE`;
        const loan = await tx.loan.findFirst({ where: { id: loanId, deletedAt: null } });
        if (!loan) throw new NotFoundException('Loan not found');
        await this.loanLedger.scope(user, loan);
        if (
          !['ACTIVE', 'DEFAULTED', 'RESTRUCTURED'].includes(loan.status) ||
          loan.outstandingBalance.lte(0)
        )
          throw new BadRequestException('Choose an active loan with outstanding principal.');
        if (
          await tx.loanRepaymentSchedule.count({ where: { loanDebtId: loanId, deletedAt: null } })
        )
          throw new BadRequestException('Loan already has scheduled installments.');
        if (
          await tx.loanRepayment.count({
            where: {
              loanId,
              OR: [{ financialEvent: null }, { financialEvent: { reversedAt: null } }],
            },
          })
        )
          throw new BadRequestException(
            'This loan already has repayments. A new schedule needs a reviewed restructuring.',
          );
        const opening = await tx.loanFinancialEvent.findFirst({
          where: { loanId, kind: { in: ['OPENING', 'DISBURSEMENT'] }, reversedAt: null },
        });
        if (!opening)
          throw new BadRequestException(
            'Recognize the loan in accounting before generating its schedule.',
          );
        const start = opening.businessDate;
        const profile = this.frequencyProfile(loan.repaymentFrequency);
        const periodCount = this.computePeriodCount(start, loan.maturityDate, profile);
        if (periodCount <= 0 || periodCount > 1200)
          throw new BadRequestException(
            'Loan term must be positive and contain at most 1,200 installments.',
          );
        const periodicRate =
          profile.monthsPerPeriod > 0
            ? new Prisma.Decimal(loan.interestRate).div(profile.periodsPerYear).toNumber()
            : new Prisma.Decimal(loan.interestRate)
                .mul((loan.maturityDate.getTime() - start.getTime()) / 86400000)
                .div(365)
                .toNumber();
        const installments = this.amortize(
          Number(loan.outstandingBalance),
          periodicRate,
          periodCount,
        );
        if (installments.some((row) => new Prisma.Decimal(row.principal).plus(row.interest).lte(0)))
          throw new BadRequestException(
            'This principal is too small for the selected number of installments. Use a shorter schedule.',
          );
        const created = [];
        for (const [idx, row] of installments.entries()) {
          const regularDate =
            profile.monthsPerPeriod > 0 ? profile.advance(start, idx + 1) : loan.maturityDate;
          const dueDate =
            regularDate > loan.maturityDate || idx === installments.length - 1
              ? loan.maturityDate
              : regularDate;
          const total = new Prisma.Decimal(row.principal).plus(row.interest);
          created.push(
            await tx.loanRepaymentSchedule.create({
              data: {
                repaymentScheduleNumber: `LRS-${loanId}-${idx + 1}`,
                companyId: loan.companyId!,
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
            }),
          );
        }
        await this.auditLogs.logStrictInTransaction(tx, {
          action: 'GENERATE',
          entityType: 'LoanRepaymentSchedule',
          entityId: loanId,
          userId: user.id,
          companyId: loan.companyId!,
          metadata: { installments: created.length, repaymentFrequency: loan.repaymentFrequency },
        });
        return { installments: created.length, scheduleIds: created.map((r) => r.id) };
      },
      { timeout: 30000 },
    );
  }

  async getPayments(scheduleId: string, user?: AuthUser) {
    if (user) await this.findOne(scheduleId, user);
    return this.prisma.loanRepaymentPayment.findMany({
      where: { loanRepaymentScheduleId: scheduleId, deletedAt: null },
      include: { financialEvent: true },
      orderBy: { paymentDate: 'asc' },
    });
  }

  /**
   * Record a payment against a scheduled installment, generate the JE,
   * advance the schedule and the parent loan's outstanding balance, and
   * mark the schedule PAID / PARTIALLY_PAID accordingly.
   */
  async recordPayment(scheduleId: string, dto: RecordLoanRepaymentDto, user: AuthUser) {
    const schedule = await this.findOne(scheduleId, user);
    return this.lifecycle.repay(schedule.loanDebtId, dto, user, scheduleId);
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
    const p = loanMoney(principal, 'Principal'),
      rate = new Prisma.Decimal(periodicRate);
    const factor = rate.plus(1).pow(n);
    const emi = rate.isZero() ? p.div(n) : p.mul(rate).mul(factor).div(factor.minus(1));
    let remaining = p;
    const result = [];
    for (let i = 0; i < n; i++) {
      const interest = remaining.mul(rate).toDecimalPlaces(2);
      const part =
        i === n - 1
          ? remaining
          : Prisma.Decimal.min(
              remaining,
              Prisma.Decimal.max(0, emi.minus(interest).toDecimalPlaces(2)),
            );
      result.push({ principal: part.toNumber(), interest: interest.toNumber() });
      remaining = remaining.minus(part);
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
    if (end <= start) return 0;
    if (profile.monthsPerPeriod <= 0) return 1; // BULLET / OTHER → single balloon
    return Math.max(1, Math.ceil(months / profile.monthsPerPeriod));
  }

  /** Whole calendar months between two dates (>= 0). */
  private tenureMonths(start: Date, end: Date): number {
    return (
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth())
    );
  }

  private addMonths(date: Date, n: number): Date {
    const d = new Date(date);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d;
  }
}
