import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';

/**
 * Loan repayment scheduling and payment posting.
 *
 * Schedule generation: given a Loan (principal, annualInterestRate, tenureMonths),
 * produce an `installmentNumber`-ordered set of LoanRepaymentSchedule rows
 * using the standard French amortization formula:
 *   `EMI = P × r × (1+r)^n / ((1+r)^n - 1)`,
 * where r = monthly rate, n = tenure in months.
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
  ) {}

  async findAll(query: any) {
    const { companyId, loanId, status, page = 1, limit = 50 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
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

  async create(dto: any, user: any) {
    const item = await this.prisma.loanRepaymentSchedule.create({
      data: { ...dto, createdById: user.id },
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
      throw new BadRequestException('Loans without a companyId cannot have an auto-generated schedule');
    }

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
    const tenureMonths = this.computeTenureMonths(loan.disbursementDate, loan.maturityDate, loan.repaymentFrequency);
    if (tenureMonths <= 0) {
      throw new BadRequestException('Loan maturityDate must be after disbursementDate');
    }
    const monthlyRate = annualRate / 12;
    const installments = this.amortize(principal, monthlyRate, tenureMonths);

    const companyId = loan.companyId;
    const created = await this.prisma.$transaction(async (tx) => {
      const rows = installments.map((row, idx) => {
        const dueDate = this.addMonths(loan.disbursementDate, idx + 1);
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
      metadata: { installments: created.length, tenureMonths },
    });

    return { installments: created.length };
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
  async recordPayment(scheduleId: string, dto: any, user: any) {
    const schedule = await this.findOne(scheduleId);
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('amount must be positive');
    const outstanding = Number(schedule.outstandingAmount);
    if (amount > outstanding + 0.01) {
      throw new BadRequestException(
        `Payment amount ${amount} exceeds outstanding ${outstanding}`,
      );
    }

    const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    await this.accountingControl.assertPostingAllowed({
      companyId: schedule.companyId,
      transactionDate: paymentDate,
      moduleName: 'loan_repayment',
    });

    // Allocate this payment proportionally between scheduled principal and interest.
    const totalScheduled = Number(schedule.principalAmount) + Number(schedule.interestAmount);
    const principalPortion =
      totalScheduled > 0 ? (amount * Number(schedule.principalAmount)) / totalScheduled : amount;
    const interestPortion = amount - principalPortion;

    const result = await this.prisma.$transaction(async (tx) => {
      const principalAccount = await this.accountResolver.resolve(
        schedule.companyId,
        'LOAN_PRINCIPAL_PAYABLE',
        tx,
      );
      const interestAccount = await this.accountResolver.resolve(
        schedule.companyId,
        'LOAN_INTEREST_EXPENSE',
        tx,
      );
      const cashAccount = await this.accountResolver.resolve(
        schedule.companyId,
        'CASH_ON_HAND',
        tx,
      );

      const journalNumber = await this.codes.next({ entityType: 'LoanJournal', companyId: schedule.companyId, tx });
      const je = await tx.journalEntry.create({
        data: {
          journalNumber,
          companyId: schedule.companyId,
          transactionDate: paymentDate,
          description: `Loan repayment installment #${schedule.installmentNumber}`,
          totalDebit: amount,
          totalCredit: amount,
          status: 'POSTED',
          createdById: user.id,
          postedById: user.id,
          postedAt: new Date(),
          referenceType: 'LoanRepaymentSchedule',
          referenceId: schedule.id,
        },
      });

      await tx.journalEntryLine.createMany({
        data: [
          {
            journalEntryId: je.id,
            companyId: schedule.companyId,
            accountId: principalAccount.id,
            description: 'Principal portion',
            debit: principalPortion,
            credit: 0,
          },
          {
            journalEntryId: je.id,
            companyId: schedule.companyId,
            accountId: interestAccount.id,
            description: 'Interest portion',
            debit: interestPortion,
            credit: 0,
          },
          {
            journalEntryId: je.id,
            companyId: schedule.companyId,
            accountId: cashAccount.id,
            description: 'Cash paid',
            debit: 0,
            credit: amount,
          },
        ],
      });

      const repaymentPaymentNumber = await this.codes.next({ entityType: 'LoanRepaymentPayment', companyId: schedule.companyId, tx });
      const payment = await tx.loanRepaymentPayment.create({
        data: {
          repaymentPaymentNumber,
          companyId: schedule.companyId,
          loanRepaymentScheduleId: schedule.id,
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

      const newPaid = Number(schedule.paidAmount) + amount;
      const newOutstanding = Math.max(0, outstanding - amount);
      const newStatus: 'PAID' | 'PARTIALLY_PAID' = newOutstanding === 0 ? 'PAID' : 'PARTIALLY_PAID';
      await tx.loanRepaymentSchedule.update({
        where: { id: schedule.id },
        data: {
          paidAmount: newPaid,
          outstandingAmount: newOutstanding,
          status: newStatus,
          journalEntryId: je.id,
        },
      });

      // Decrement principal on the parent loan.
      await tx.loan.update({
        where: { id: schedule.loanDebtId },
        data: { outstandingBalance: { decrement: new Prisma.Decimal(principalPortion) } },
      });

      return payment;
    });

    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'LoanRepaymentPayment',
      entityId: result.id,
      userId: user.id,
      companyId: schedule.companyId,
      metadata: { amount, principalPortion, interestPortion, scheduleId: schedule.id },
    });
    return result;
  }

  // ─── Math helpers ────────────────────────────────────────────────────────

  /**
   * French amortization: returns an array of {principal, interest} per month.
   * Uses `EMI = P × r × (1+r)^n / ((1+r)^n - 1)`. Falls back to flat principal
   * split when r ≈ 0 to avoid divide-by-zero.
   */
  private amortize(principal: number, monthlyRate: number, n: number): Array<{ principal: number; interest: number }> {
    const rounded = (x: number) => Math.round(x * 100) / 100;
    if (monthlyRate < 1e-9) {
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
    const factor = Math.pow(1 + monthlyRate, n);
    const emi = (principal * monthlyRate * factor) / (factor - 1);
    let remaining = principal;
    const result: Array<{ principal: number; interest: number }> = [];
    for (let i = 0; i < n; i++) {
      const interest = remaining * monthlyRate;
      let principalPart = emi - interest;
      // Final installment absorbs rounding drift.
      if (i === n - 1) principalPart = remaining;
      result.push({ principal: rounded(principalPart), interest: rounded(interest) });
      remaining -= principalPart;
    }
    return result;
  }

  private computeTenureMonths(start: Date, end: Date, frequency: string): number {
    const months =
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    switch (frequency) {
      case 'WEEKLY':
        return Math.max(1, Math.round((months * 30) / 7));
      case 'BIWEEKLY':
        return Math.max(1, Math.round((months * 30) / 14));
      case 'QUARTERLY':
        return Math.max(1, Math.floor(months / 3));
      case 'SEMIANNUAL':
        return Math.max(1, Math.floor(months / 6));
      case 'ANNUAL':
        return Math.max(1, Math.floor(months / 12));
      case 'MONTHLY':
      default:
        return Math.max(1, months);
    }
  }

  private addMonths(date: Date, n: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + n);
    return d;
  }
}
