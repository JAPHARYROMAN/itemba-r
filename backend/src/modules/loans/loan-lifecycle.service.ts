import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BorrowerLevel, Loan, LoanPaymentMethod, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LoanLedgerService } from './loan-ledger.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { ReverseLoanEventDto } from './dto/reverse-loan-event.dto';
import {
  allocateLoanPayment,
  allocateScheduledPayment,
  loanDate,
  loanMoney,
} from './loan-allocation';
import { payloadKey } from '../cash-desk/cash-desk.domain';
import { PostingLine } from '../accounting-engine/posting-engine.service';

type Tx = Prisma.TransactionClient;
export type ScheduledPaymentInput = {
  requestId: string;
  amount: number | string;
  paymentDate?: string;
  currency?: string;
  cashDeskAccountId: string;
  interestAccountId?: string;
  feeAccountId?: string;
  paymentMethod?: LoanPaymentMethod;
  reference?: string;
  allocationFingerprint: string;
};
@Injectable()
export class LoanLifecycleService {
  constructor(
    private readonly db: PrismaService,
    private readonly ledger: LoanLedgerService,
    private readonly audit: AuditLogsService,
  ) {}
  private async transaction<T>(work: (tx: Tx) => Promise<T>) {
    try {
      return await this.db.$transaction(work, { timeout: 30000 });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException(
          'This loan or payment changed. Refresh and retry with the same request reference.',
        );
      throw error;
    }
  }
  private async request(tx: Tx, user: AuthUser, requestId: string, input: object) {
    if (!requestId) throw new BadRequestException('A payment request reference is required.');
    // Serialize retries before touching the loan or any account; the unique key is a final guard.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`loan:${requestId}`}, 0))`;
    const previous = await tx.loanFinancialEvent.findUnique({ where: { requestId } });
    const key = payloadKey(input);
    if (previous && (previous.createdById !== user.id || previous.payloadKey !== key))
      throw new ConflictException('This request reference was used for different loan details.');
    return { previous, key };
  }
  private async lockedLoan(tx: Tx, user: AuthUser, id: string) {
    await tx.$queryRaw`SELECT id FROM loans WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
    const loan = await tx.loan.findFirst({ where: { id, deletedAt: null } });
    if (!loan) throw new NotFoundException('Loan not found.');
    await this.ledger.scope(user, loan);
    return loan;
  }
  private auditEvent(tx: Tx, user: AuthUser, loan: Loan, id: string, action: string) {
    return this.audit.logStrictInTransaction(tx, {
      action,
      entityType: 'LoanFinancialEvent',
      entityId: id,
      companyId: loan.companyId!,
      userId: user.id,
      metadata: { loanId: loan.id },
    });
  }
  async options(user: AuthUser, companyId?: string) {
    if (!companyId) return { cash: [], ledger: [] };
    const where = await this.ledger.readWhere(user, companyId);
    const [cash, ledger] = await Promise.all([
      this.db.cashDeskAccount.findMany({
        where: {
          ...where,
          erpCashAccount: {
            isActive: true,
            deletedAt: null,
            ledgerAccount: { isActive: true, deletedAt: null },
          },
        },
        select: {
          id: true,
          name: true,
          currency: true,
          companyId: true,
          divisionId: true,
          branchId: true,
          erpCashAccountId: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.db.chartOfAccount.findMany({
        where: {
          ...where,
          isActive: true,
          deletedAt: null,
          accountType: { in: ['ASSET', 'LIABILITY', 'EXPENSE', 'INCOME', 'EQUITY'] },
        },
        select: {
          id: true,
          accountCode: true,
          accountName: true,
          accountType: true,
          companyId: true,
          divisionId: true,
          branchId: true,
        },
        orderBy: { accountCode: 'asc' },
      }),
    ]);
    return { cash, ledger };
  }
  private allocationKey(
    schedule: {
      id: string;
      paidAmount: Prisma.Decimal;
      principalAmount: Prisma.Decimal;
      interestAmount: Prisma.Decimal;
      feeAmount: Prisma.Decimal;
    },
    outstanding: Prisma.Decimal,
    paid: { principal: Prisma.Decimal; interest: Prisma.Decimal; fees: Prisma.Decimal },
  ) {
    return payloadKey({
      id: schedule.id,
      paidAmount: schedule.paidAmount.toFixed(2),
      principal: schedule.principalAmount.toFixed(2),
      interest: schedule.interestAmount.toFixed(2),
      fees: schedule.feeAmount.toFixed(2),
      outstanding: outstanding.toFixed(2),
      paid,
    });
  }
  async previewScheduled(scheduleId: string, amount: string, user: AuthUser) {
    return this.db.$transaction(
      async (tx) => {
        const schedule = await tx.loanRepaymentSchedule.findFirst({
          where: { id: scheduleId, deletedAt: null },
          include: { payments: { where: { deletedAt: null }, include: { financialEvent: true } } },
        });
        if (!schedule) throw new NotFoundException('Installment not found.');
        const loan = await tx.loan.findFirst({
          where: { id: schedule.loanDebtId, deletedAt: null },
        });
        if (!loan) throw new NotFoundException('Loan not found.');
        await this.ledger.scope(user, loan, false);
        if (schedule.payments.some((p) => !p.financialEvent))
          throw new BadRequestException('Historical scheduled allocations require review.');
        const active = schedule.payments.flatMap((p) =>
          p.financialEvent && !p.financialEvent.reversedAt ? [p.financialEvent] : [],
        );
        const sum = (key: 'principal' | 'interest' | 'fees') =>
          active.reduce((n, e) => n.plus(e[key]), new Prisma.Decimal(0));
        const paid = { principal: sum('principal'), interest: sum('interest'), fees: sum('fees') };
        const result = allocateScheduledPayment(amount, {
          principal: schedule.principalAmount.minus(paid.principal),
          interest: schedule.interestAmount.minus(paid.interest),
          fees: schedule.feeAmount.minus(paid.fees),
        });
        if (result.principal.gt(loan.outstandingBalance))
          throw new BadRequestException('Scheduled principal exceeds the remaining loan.');
        return {
          ...result,
          currency: loan.currency,
          allocationFingerprint: this.allocationKey(schedule, loan.outstandingBalance, paid),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async create(dto: CreateLoanDto, user: AuthUser) {
    if (!['NEW', 'OPENING'].includes(dto.fundingMode))
      throw new BadRequestException('Choose new borrowing or an opening loan balance explicitly.');
    if (['INTER_COMPANY_LOAN', 'SUPPLIER_CREDIT'].includes(dto.obligationType || ''))
      throw new BadRequestException(
        'Use Cash Desk for intercompany lending and Invoice Desk for supplier credit, so their connected balances are not counted twice.',
      );
    this.ledger.permissions(user, dto.fundingMode === 'NEW');
    const principal = loanMoney(dto.principalAmount, 'Principal'),
      outstanding = loanMoney(dto.outstandingBalance, 'Outstanding principal');
    const disbursementDate = loanDate(dto.disbursementDate),
      maturityDate = loanDate(dto.maturityDate);
    const date =
      dto.fundingMode === 'OPENING'
        ? loanDate(dto.recognitionDate || dto.disbursementDate)
        : disbursementDate;
    const fees = loanMoney(dto.fees, 'Disbursement fees');
    if (
      principal.lte(0) ||
      outstanding.lte(0) ||
      outstanding.gt(principal) ||
      maturityDate <= disbursementDate ||
      date < disbursementDate
    )
      throw new BadRequestException(
        'Enter positive principal, valid outstanding principal and a maturity after disbursement.',
      );
    if (dto.fundingMode === 'NEW' && !outstanding.eq(principal))
      throw new BadRequestException('A new borrowing starts with the full principal outstanding.');
    if (dto.fundingMode === 'OPENING' && (dto.cashDeskAccountId || fees.gt(0)))
      throw new BadRequestException('Opening balances do not record cash or disbursement fees.');
    if (fees.gte(principal))
      throw new BadRequestException('Disbursement fees must be less than the principal.');
    const rate = new Prisma.Decimal(dto.interestRate);
    if (!rate.isFinite() || rate.lt(0) || rate.gt('99.9999') || rate.decimalPlaces() > 4)
      throw new BadRequestException('Enter a valid annual interest rate as a decimal fraction.');
    const selectedCash =
      dto.fundingMode === 'NEW' && dto.cashDeskAccountId
        ? await this.db.cashDeskAccount.findUnique({ where: { id: dto.cashDeskAccountId } })
        : null;
    const scope = await this.ledger.scope(user, {
      companyId: dto.companyId || null,
      divisionId: dto.divisionId || selectedCash?.divisionId || null,
      branchId: dto.branchId || selectedCash?.branchId || null,
    });
    return this.transaction(async (tx) => {
      const { previous, key } = await this.request(tx, user, dto.requestId, {
        operation: 'CREATE',
        ...dto,
      });
      if (previous) return tx.loan.findUniqueOrThrow({ where: { id: previous.loanId } });
      const company = await tx.company.findFirst({
        where: { id: scope.companyId, deletedAt: null },
      });
      if (!company || (dto.groupId && dto.groupId !== company.groupId))
        throw new BadRequestException('Choose an accounting company in the borrowing group.');
      if (scope.branchId) {
        const branch = await tx.branch.findFirst({
          where: {
            id: scope.branchId,
            deletedAt: null,
            division: { companyId: scope.companyId, deletedAt: null },
          },
        });
        if (!branch || (scope.divisionId && branch.divisionId !== scope.divisionId))
          throw new BadRequestException(
            'Branch and division must belong to the accounting company.',
          );
        scope.divisionId = branch.divisionId;
      }
      if (
        scope.divisionId &&
        !(await tx.division.findFirst({
          where: { id: scope.divisionId, companyId: scope.companyId, deletedAt: null },
        }))
      )
        throw new BadRequestException('Division must belong to the accounting company.');
      await this.ledger.scope(user, scope);
      if (dto.fundingMode === 'NEW') {
        const receiving = dto.cashDeskAccountId
          ? await tx.cashDeskAccount.findUnique({ where: { id: dto.cashDeskAccountId } })
          : null;
        if (
          !receiving ||
          receiving.companyId !== scope.companyId ||
          (scope.divisionId && scope.divisionId !== receiving.divisionId) ||
          (scope.branchId && scope.branchId !== receiving.branchId)
        )
          throw new BadRequestException(
            'Choose a receiving Cash Desk account in the loan organisation.',
          );
        scope.divisionId = receiving.divisionId;
        scope.branchId = receiving.branchId;
        await this.ledger.scope(user, scope);
      }
      const currency = dto.currency || 'TZS';
      await this.ledger.currency(tx, scope.companyId, currency);
      const payable = await this.ledger.account(
        tx,
        dto.principalLedgerAccountId,
        scope,
        'LIABILITY',
      );
      const loan = await tx.loan.create({
        data: {
          ...scope,
          fundingMode: dto.fundingMode,
          principalLedgerAccountId: payable.id,
          obligationType: dto.obligationType,
          borrowerLevel: dto.borrowerLevel || BorrowerLevel.COMPANY,
          groupId: dto.borrowerLevel === 'GROUP' ? company.groupId : dto.groupId,
          loanReference: dto.loanReference,
          lenderName: dto.lenderName,
          lenderType: dto.lenderType,
          lenderContact: dto.lenderContact,
          principalAmount: principal,
          outstandingBalance: outstanding,
          currency,
          interestRate: rate,
          disbursementDate,
          maturityDate,
          repaymentFrequency: dto.repaymentFrequency,
          repaymentAmount: dto.repaymentAmount ? loanMoney(dto.repaymentAmount) : null,
          status: 'ACTIVE',
          riskLevel: dto.riskLevel,
          purpose: dto.purpose,
          collateralDescription: dto.collateralDescription,
          linkedAssetIds: dto.linkedAssetIds || [],
          guarantorName: dto.guarantorName,
          guarantorContact: dto.guarantorContact,
          guaranteeDetails: dto.guaranteeDetails,
          notes: dto.notes,
          createdById: user.id,
        },
      });
      const eventId = randomUUID(),
        lines: PostingLine[] = [];
      let movementId: string | undefined;
      if (dto.fundingMode === 'NEW') {
        const cash = await this.ledger.cash(tx, user, scope, currency, dto.cashDeskAccountId!);
        const movement = await this.ledger.movement(tx, user, cash, {
          requestId: dto.requestId,
          kind: 'BORROWING',
          date,
          amount: principal.minus(fees),
          description: `Borrowing · ${dto.loanReference || dto.lenderName}`,
          reference: dto.loanReference || '',
        });
        movementId = movement.id;
        lines.push({
          accountId: cash.ledger.id,
          debit: principal.minus(fees),
          credit: 0,
          description: 'Net loan proceeds',
        });
        if (fees.gt(0)) {
          const expense = await this.ledger.account(tx, dto.feeAccountId, scope, 'EXPENSE');
          lines.push({
            accountId: expense.id,
            debit: fees,
            credit: 0,
            description: 'Fees withheld at disbursement',
          });
        }
      } else {
        const equity = await this.ledger.account(tx, dto.openingOffsetAccountId, scope, 'EQUITY');
        lines.push({
          accountId: equity.id,
          debit: outstanding,
          credit: 0,
          description: 'Reviewed opening loan balance',
        });
      }
      lines.push({
        accountId: payable.id,
        debit: 0,
        credit: outstanding,
        description: 'Loan principal payable',
      });
      const journal = await this.ledger.post(
        tx,
        user,
        scope,
        date,
        eventId,
        `${dto.fundingMode === 'NEW' ? 'Loan disbursement' : 'Opening loan balance'} · ${dto.loanReference || dto.lenderName}`,
        lines,
      );
      await tx.loanFinancialEvent.create({
        data: {
          id: eventId,
          loanId: loan.id,
          requestId: dto.requestId,
          payloadKey: key,
          kind: dto.fundingMode === 'NEW' ? 'DISBURSEMENT' : 'OPENING',
          businessDate: date,
          amount: dto.fundingMode === 'NEW' ? principal.minus(fees) : outstanding,
          principal: outstanding,
          fees,
          currency,
          cashMovementId: movementId,
          journalEntryId: journal.id,
          createdById: user.id,
        },
      });
      await this.auditEvent(tx, user, loan, eventId, 'LOAN_RECOGNIZED');
      return loan;
    });
  }
  async repay(
    loanId: string,
    dto: RecordRepaymentDto | ScheduledPaymentInput,
    user: AuthUser,
    scheduleId?: string,
  ) {
    this.ledger.permissions(user);
    return this.transaction(async (tx) => {
      const { previous, key } = await this.request(tx, user, dto.requestId, {
        operation: 'REPAY',
        loanId,
        scheduleId,
        ...dto,
      });
      const loan = await this.lockedLoan(tx, user, loanId);
      if (previous)
        return previous.scheduledPaymentId
          ? tx.loanRepaymentPayment.findUniqueOrThrow({
              where: { id: previous.scheduledPaymentId },
            })
          : tx.loanRepayment.findUniqueOrThrow({ where: { id: previous.repaymentId! } });
      if (!['ACTIVE', 'DEFAULTED', 'RESTRUCTURED'].includes(loan.status))
        throw new BadRequestException('Only an active loan can receive payments.');
      if (loan.fundingMode === 'LEGACY' || !loan.principalLedgerAccountId)
        throw new BadRequestException(
          'Review and connect this legacy loan to its opening ledger evidence before recording more payments.',
        );
      const scope = await this.ledger.scope(user, loan);
      const date = loanDate(
        'repaymentDate' in dto
          ? dto.repaymentDate
          : dto.paymentDate || new Date().toISOString().slice(0, 10),
      );
      const opening = await tx.loanFinancialEvent.findFirst({
        where: { loanId, kind: { in: ['OPENING', 'DISBURSEMENT'] }, reversedAt: null },
      });
      if (
        !opening ||
        date < opening.businessDate ||
        (dto.currency && dto.currency !== loan.currency)
      )
        throw new BadRequestException(
          'Payment currency must match the loan and its date cannot precede loan recognition.',
        );
      const schedule = scheduleId
        ? await tx.loanRepaymentSchedule.findFirst({
            where: {
              id: scheduleId,
              loanDebtId: loanId,
              companyId: scope.companyId,
              deletedAt: null,
            },
            include: {
              payments: { where: { deletedAt: null }, include: { financialEvent: true } },
            },
          })
        : null;
      if (scheduleId && !schedule) throw new NotFoundException('Loan installment not found.');
      if (
        !scheduleId &&
        (await tx.loanRepaymentSchedule.count({ where: { loanDebtId: loanId, deletedAt: null } }))
      )
        throw new BadRequestException(
          'This loan has a schedule. Record payment against its installment.',
        );
      let allocation: ReturnType<typeof allocateLoanPayment>;
      if (schedule) {
        if (schedule.payments.some((p) => !p.financialEvent))
          throw new BadRequestException(
            'Historical scheduled payments need an allocation review before another payment.',
          );
        const events = schedule.payments.flatMap((p) =>
          p.financialEvent && !p.financialEvent.reversedAt ? [p.financialEvent] : [],
        );
        const paid = (field: 'principal' | 'interest' | 'fees') =>
          events.reduce((sum, e) => sum.plus(e[field]), new Prisma.Decimal(0));
        if (
          (dto as ScheduledPaymentInput).allocationFingerprint !==
          this.allocationKey(schedule, loan.outstandingBalance, {
            principal: paid('principal'),
            interest: paid('interest'),
            fees: paid('fees'),
          })
        )
          throw new ConflictException(
            'The installment allocation changed. Refresh the payment review before saving.',
          );
        if (
          !schedule.totalAmount.eq(
            schedule.principalAmount.plus(schedule.interestAmount).plus(schedule.feeAmount),
          ) ||
          !schedule.paidAmount.eq(
            events.reduce((n, e) => n.plus(e.amount), new Prisma.Decimal(0)),
          ) ||
          !schedule.outstandingAmount.eq(schedule.totalAmount.minus(schedule.paidAmount))
        )
          throw new BadRequestException(
            'The installment totals do not agree with its payment history. Review it first.',
          );
        allocation = allocateScheduledPayment(dto.amount, {
          principal: schedule.principalAmount.minus(paid('principal')),
          interest: schedule.interestAmount.minus(paid('interest')),
          fees: schedule.feeAmount.minus(paid('fees')),
        });
        if (allocation.principal.gt(loan.outstandingBalance))
          throw new BadRequestException('Scheduled principal exceeds the remaining loan balance.');
      } else allocation = allocateLoanPayment(dto as RecordRepaymentDto, loan.outstandingBalance);
      const cash = await this.ledger.cash(tx, user, scope, loan.currency, dto.cashDeskAccountId);
      const payable = await this.ledger.account(
        tx,
        loan.principalLedgerAccountId,
        scope,
        'LIABILITY',
      );
      const lines: PostingLine[] = [
        {
          accountId: cash.ledger.id,
          debit: 0,
          credit: allocation.amount,
          description: 'Loan payment',
          divisionId: cash.account.divisionId,
          branchId: cash.account.branchId,
        },
      ];
      if (allocation.principal.gt(0))
        lines.unshift({
          accountId: payable.id,
          debit: allocation.principal,
          credit: 0,
          description: 'Principal',
        });
      if (allocation.interest.gt(0)) {
        const interest = await this.ledger.account(tx, dto.interestAccountId, scope, 'EXPENSE');
        lines.push({
          accountId: interest.id,
          debit: allocation.interest,
          credit: 0,
          description: 'Interest',
        });
      }
      if (allocation.fees.plus(allocation.penalties).gt(0)) {
        const fee = await this.ledger.account(tx, dto.feeAccountId, scope, 'EXPENSE');
        if (allocation.fees.gt(0))
          lines.push({ accountId: fee.id, debit: allocation.fees, credit: 0, description: 'Fees' });
        if (allocation.penalties.gt(0))
          lines.push({
            accountId: fee.id,
            debit: allocation.penalties,
            credit: 0,
            description: 'Penalties',
          });
      }
      const reference =
        ('referenceNumber' in dto
          ? dto.referenceNumber
          : (dto as ScheduledPaymentInput).reference) || '';
      const movement = await this.ledger.movement(tx, user, cash, {
        requestId: dto.requestId,
        kind: 'DEBT_REPAYMENT',
        date,
        amount: allocation.amount.negated(),
        description: `Loan repayment · ${loan.loanReference || loan.lenderName}`,
        reference,
      });
      const eventId = randomUUID();
      const journal = await this.ledger.post(
        tx,
        user,
        scope,
        date,
        eventId,
        `Loan repayment · ${loan.loanReference || loan.lenderName}`,
        lines,
      );
      const remaining = loan.outstandingBalance.minus(allocation.principal);
      let repaymentId: string | undefined, scheduledPaymentId: string | undefined, result: unknown;
      if (schedule) {
        const payment = await tx.loanRepaymentPayment.create({
          data: {
            repaymentPaymentNumber: `LRP-${randomUUID()}`,
            companyId: scope.companyId,
            loanRepaymentScheduleId: schedule.id,
            paymentDate: date,
            amount: allocation.amount,
            currency: loan.currency,
            paymentMethod: (dto as ScheduledPaymentInput).paymentMethod || 'BANK_TRANSFER',
            cashAccountId: cash.account.erpCashAccountId,
            reference,
            journalEntryId: journal.id,
            paidById: user.id,
          },
        });
        scheduledPaymentId = payment.id;
        result = payment;
        const outstanding = schedule.outstandingAmount.minus(allocation.amount);
        await tx.loanRepaymentSchedule.update({
          where: { id: schedule.id },
          data: {
            paidAmount: schedule.paidAmount.plus(allocation.amount),
            outstandingAmount: outstanding,
            status: outstanding.isZero() ? 'PAID' : 'PARTIALLY_PAID',
            journalEntryId: journal.id,
          },
        });
      } else {
        const input = dto as RecordRepaymentDto;
        const payment = await tx.loanRepayment.create({
          data: {
            loanId,
            repaymentDate: date,
            amount: allocation.amount,
            currency: loan.currency,
            principal: allocation.principal,
            interest: allocation.interest,
            penalties: allocation.penalties,
            remainingBalance: remaining,
            paymentMethod: input.paymentMethod,
            referenceNumber: reference,
            notes: input.notes,
            recordedById: user.id,
          },
        });
        repaymentId = payment.id;
        result = payment;
      }
      await tx.loanFinancialEvent.create({
        data: {
          id: eventId,
          loanId,
          requestId: dto.requestId,
          payloadKey: key,
          kind: 'REPAYMENT',
          businessDate: date,
          ...allocation,
          currency: loan.currency,
          cashMovementId: movement.id,
          journalEntryId: journal.id,
          scheduleId,
          repaymentId,
          scheduledPaymentId,
          createdById: user.id,
        },
      });
      const unpaidSchedules = await tx.loanRepaymentSchedule.count({
        where: { loanDebtId: loanId, deletedAt: null, outstandingAmount: { gt: 0 } },
      });
      await tx.loan.update({
        where: { id: loanId },
        data: {
          outstandingBalance: remaining,
          status: remaining.isZero() && unpaidSchedules === 0 ? 'FULLY_PAID' : loan.status,
        },
      });
      await this.auditEvent(tx, user, loan, eventId, 'LOAN_PAYMENT_POSTED');
      return result;
    });
  }
  async reverse(loanId: string, eventId: string, dto: ReverseLoanEventDto, user: AuthUser) {
    this.ledger.permissions(user, true, true);
    return this.transaction(async (tx) => {
      const { previous, key } = await this.request(tx, user, dto.requestId, {
        operation: 'REVERSE',
        loanId,
        eventId,
        ...dto,
      });
      const loan = await this.lockedLoan(tx, user, loanId);
      if (previous) return previous;
      const event = await tx.loanFinancialEvent.findFirst({
        where: { id: eventId, loanId },
        include: {
          journalEntry: { include: { lines: true } },
          cashMovement: { include: { entries: true } },
        },
      });
      if (!event) throw new NotFoundException('Loan event not found.');
      const date = loanDate(dto.businessDate);
      if (
        event.reversedAt ||
        event.reversalOfId ||
        date < event.businessDate ||
        dto.reason.trim().length < 3
      )
        throw new BadRequestException(
          'Choose an unreversed original event, a valid reason and a date on or after it.',
        );
      if (
        event.kind !== 'REPAYMENT' &&
        (await tx.loanFinancialEvent.count({
          where: { loanId, kind: 'REPAYMENT', reversedAt: null },
        }))
      )
        throw new BadRequestException('Reverse loan repayments before reversing recognition.');
      if (
        event.kind !== 'REPAYMENT' &&
        (await tx.loanFinancialEvent.count({ where: { loanId, businessDate: { gt: date } } }))
      )
        throw new BadRequestException(
          'Recognition reversal cannot precede later loan events or payment reversals.',
        );
      const scope = await this.ledger.scope(user, loan),
        original = event.journalEntry;
      if (
        original.status !== 'POSTED' ||
        original.deletedAt ||
        original.referenceType !== 'LoanLifecycle' ||
        original.referenceId !== event.id
      )
        throw new ConflictException('The original loan journal needs review before reversal.');
      let movementId: string | undefined;
      if (event.cashMovement) {
        if (event.cashMovement.reversedAt || event.cashMovement.entries.length !== 1)
          throw new ConflictException('The linked cash movement needs review.');
        const entry = event.cashMovement.entries[0];
        const cash = await this.ledger.cash(tx, user, scope, loan.currency, entry.accountId);
        if (
          !original.lines.some(
            (l) => l.accountId === cash.ledger.id && l.debit.minus(l.credit).eq(entry.amount),
          )
        )
          throw new ConflictException('Cash and journal evidence do not agree.');
        const movement = await this.ledger.movement(tx, user, cash, {
          requestId: dto.requestId,
          kind: 'REVERSAL',
          date,
          amount: entry.amount.negated(),
          description: dto.reason.trim(),
          reference: event.cashMovement.reference,
          reversalOfId: event.cashMovement.id,
        });
        movementId = movement.id;
        await tx.cashDeskMovement.update({
          where: { id: event.cashMovement.id },
          data: { reversedAt: new Date(), reversalReason: dto.reason.trim() },
        });
      }
      const reversalId = randomUUID();
      const journal = await this.ledger.post(
        tx,
        user,
        scope,
        date,
        reversalId,
        `Reversal · ${dto.reason.trim()}`,
        original.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          description: l.description || undefined,
          divisionId: l.divisionId,
          branchId: l.branchId,
        })),
      );
      await tx.journalEntry.update({
        where: { id: original.id },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversedById: user.id,
          reversalReason: dto.reason.trim(),
        },
      });
      await tx.journalEntry.update({
        where: { id: journal.id },
        data: { reversalOfId: original.id },
      });
      if (event.scheduleId) {
        const schedule = await tx.loanRepaymentSchedule.findUniqueOrThrow({
          where: { id: event.scheduleId },
        });
        const paid = schedule.paidAmount.minus(event.amount);
        if (paid.lt(0)) throw new ConflictException('Scheduled paid balance needs review.');
        await tx.loanRepaymentSchedule.update({
          where: { id: schedule.id },
          data: {
            paidAmount: paid,
            outstandingAmount: schedule.outstandingAmount.plus(event.amount),
            status: paid.gt(0) ? 'PARTIALLY_PAID' : 'UPCOMING',
            journalEntryId: null,
          },
        });
      }
      if (event.kind !== 'REPAYMENT') {
        const used = await tx.loanRepaymentSchedule.count({
          where: { loanDebtId: loanId, deletedAt: null, paidAmount: { gt: 0 } },
        });
        if (used) throw new ConflictException('Scheduled payments still exist for this loan.');
        await tx.loanRepaymentSchedule.updateMany({
          where: { loanDebtId: loanId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }
      await tx.loan.update({
        where: { id: loanId },
        data: {
          outstandingBalance:
            event.kind === 'REPAYMENT'
              ? loan.outstandingBalance.plus(event.principal)
              : new Prisma.Decimal(0),
          status:
            event.kind === 'REPAYMENT'
              ? loan.status === 'FULLY_PAID'
                ? 'ACTIVE'
                : loan.status
              : 'CANCELLED',
        },
      });
      await tx.loanFinancialEvent.update({
        where: { id: event.id },
        data: { reversedAt: new Date(), reversalReason: dto.reason.trim() },
      });
      const reversal = await tx.loanFinancialEvent.create({
        data: {
          id: reversalId,
          loanId,
          requestId: dto.requestId,
          payloadKey: key,
          kind: `REVERSAL_${event.kind}`,
          businessDate: date,
          amount: event.amount,
          principal: event.principal,
          interest: event.interest,
          fees: event.fees,
          penalties: event.penalties,
          currency: event.currency,
          cashMovementId: movementId,
          journalEntryId: journal.id,
          reversalOfId: event.id,
          createdById: user.id,
        },
      });
      await this.auditEvent(tx, user, loan, reversalId, 'LOAN_EVENT_REVERSED');
      return reversal;
    });
  }
  async review(loanId: string, user: AuthUser) {
    return this.db.$transaction(
      async (tx) => {
        const loan = await tx.loan.findFirst({ where: { id: loanId, deletedAt: null } });
        if (!loan) throw new NotFoundException('Loan not found.');
        await this.ledger.scope(user, loan, false);
        const events = await tx.loanFinancialEvent.findMany({
          where: { loanId },
          include: {
            journalEntry: { include: { lines: true } },
            cashMovement: { include: { entries: true } },
            reversal: true,
          },
          orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }],
        });
        const issues: string[] = [];
        const active = events.filter((e) => !e.reversedAt && !e.reversalOfId);
        const principal = active.reduce(
          (n, e) => (e.kind === 'REPAYMENT' ? n.minus(e.principal) : n.plus(e.principal)),
          new Prisma.Decimal(0),
        );
        if (loan.fundingMode === 'LEGACY')
          issues.push('Historical loan recognition and scheduled allocations require review.');
        else if (!principal.eq(loan.outstandingBalance))
          issues.push('Loan principal does not agree with linked financial events.');
        for (const event of events) {
          const journal = event.journalEntry;
          if (
            journal.deletedAt ||
            journal.status !== (event.reversedAt ? 'REVERSED' : 'POSTED') ||
            journal.referenceType !== 'LoanLifecycle' ||
            journal.referenceId !== event.id
          )
            issues.push(`Journal evidence needs review for ${event.id}.`);
          if (!journal.totalDebit.eq(journal.totalCredit))
            issues.push(`Unbalanced journal ${journal.journalNumber}.`);
          const expectedPrincipal = event.kind.includes('REPAYMENT')
            ? event.principal.negated()
            : event.principal;
          const sign = event.reversalOfId ? -1 : 1;
          const ledgerPrincipal = journal.lines
            .filter((l) => l.accountId === loan.principalLedgerAccountId)
            .reduce((n, l) => n.plus(l.credit).minus(l.debit), new Prisma.Decimal(0));
          if (!ledgerPrincipal.eq(expectedPrincipal.mul(sign)))
            issues.push(`Principal allocation differs from journal ${journal.journalNumber}.`);
          if (event.kind.includes('OPENING')) {
            if (event.cashMovement)
              issues.push('Opening recognition unexpectedly contains a cash movement.');
            continue;
          }
          const cash = event.cashMovement;
          const expectedCash = event.amount.mul(event.kind.includes('REPAYMENT') ? -sign : sign);
          if (
            !cash ||
            cash.entries.length !== 1 ||
            !cash.entries[0].amount.eq(expectedCash) ||
            !cash.amount.eq(event.amount) ||
            cash.currency !== event.currency ||
            cash.businessDate.getTime() !== event.businessDate.getTime()
          )
            issues.push(`Cash movement differs from loan event ${event.id}.`);
          else {
            const account = await tx.cashDeskAccount.findUnique({
              where: { id: cash.entries[0].accountId },
              include: { erpCashAccount: true },
            });
            const cashLedger = journal.lines
              .filter((l) => l.accountId === account?.erpCashAccount?.ledgerAccountId)
              .reduce((n, l) => n.plus(l.debit).minus(l.credit), new Prisma.Decimal(0));
            if (!cashLedger.eq(expectedCash))
              issues.push(`Cash journal differs from loan event ${event.id}.`);
          }
        }
        const schedules = await tx.loanRepaymentSchedule.findMany({
          where: { loanDebtId: loanId, deletedAt: null },
          orderBy: { installmentNumber: 'asc' },
        });
        if (
          schedules.length &&
          !schedules
            .reduce((n, s) => n.plus(s.principalAmount), new Prisma.Decimal(0))
            .eq(
              active
                .filter((e) => e.kind !== 'REPAYMENT')
                .reduce((n, e) => n.plus(e.principal), new Prisma.Decimal(0)),
            )
        )
          issues.push('Scheduled principal does not agree with recognized principal.');
        return {
          loan,
          events,
          issues,
          agrees: issues.length === 0,
          expectedPrincipal: principal.toFixed(2),
          schedules,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
}
