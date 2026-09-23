import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, PayrollRun, Prisma, SalaryPaymentMethod } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { OrganizationScopeService } from '../../../common/services/organization-scope.service';
import { mappedCashAccount } from '../../../common/services/mapped-cash-account';
import { PostingEngineService } from '../../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../../entity-code-generator/entity-code-generator.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { cashDate, checkDailyBalances, payloadKey } from '../../cash-desk/cash-desk.domain';
import { PayPayrollRunDto, ReversePayrollPaymentDto } from './dto/payroll-run-action.dto';

type Tx = Prisma.TransactionClient;
@Injectable()
export class PayrollCashService {
  constructor(
    private readonly org: OrganizationScopeService,
    private readonly engine: PostingEngineService,
    private readonly audit: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async authorize(user: AuthUser, reverse = false) {
    const required = [
      'payroll.pay',
      'cash_desk.view',
      'cash_desk.record',
      'journal_entries.create',
      'journal_entries.post',
      ...(reverse ? ['cash_desk.reverse', 'journal_entries.reverse'] : []),
    ];
    if (!required.every((p) => user.permissions.includes(p)))
      throw new ForbiddenException(
        'Payroll payments require payroll payment, cash recording and journal posting permissions. Reversals also require cash and journal reversal permissions.',
      );
    // A run covers the whole company. A branch-only role cannot disburse it.
    await this.org.assertCanAccessScope(user, null, null, AccessLevel.WRITE);
  }

  async payment(tx: Tx, run: PayrollRun, user: AuthUser, dto: PayPayrollRunDto) {
    const date = cashDate(dto.businessDate);
    const key = payloadKey({ runId: run.id, ...dto });
    const previous = await tx.cashDeskMovement.findUnique({ where: { requestId: dto.requestId } });
    if (previous) {
      if (previous.payrollRunId !== run.id || previous.payloadKey !== key || previous.reversedAt)
        throw new ConflictException(
          'This payment request has changed or was reversed. Reload the payroll run before recording a corrected payment.',
        );
      return { duplicate: true, movement: previous };
    }
    if (
      run.status !== 'APPROVED' ||
      !run.hrApprovedById ||
      !run.financeApprovedById ||
      run.hrApprovedById === run.financeApprovedById
    )
      throw new BadRequestException(
        'Payroll must have separate HR and Finance approval before payment.',
      );
    if (
      run.paymentJournalEntryId ||
      (await tx.salaryPayment.count({
        where: { payrollRunId: run.id, deletedAt: null, status: 'PAID' },
      }))
    )
      throw new BadRequestException(
        'This run already has payment evidence. Reconcile it before recording another payment.',
      );
    await tx.$queryRaw`SELECT id FROM journal_entries WHERE id = ${run.journalEntryId} FOR UPDATE`;
    const accrual = run.journalEntryId
      ? await tx.journalEntry.findUnique({
          where: { id: run.journalEntryId },
          include: { lines: true },
        })
      : null;
    if (
      !accrual ||
      accrual.companyId !== run.companyId ||
      accrual.referenceType !== 'PayrollRun' ||
      accrual.referenceId !== run.id ||
      accrual.status !== 'POSTED' ||
      accrual.deletedAt ||
      date < new Date(accrual.transactionDate.toISOString().slice(0, 10))
    )
      throw new BadRequestException(
        'Have Accounting review and post the payroll accrual before recording payment, using a date on or after the accrual.',
      );
    const cash = await this.account(tx, run.companyId, dto.cashDeskAccountId, user);
    const net =
      (
        await tx.payrollEntry.aggregate({
          where: { payrollRunId: run.id, deletedAt: null },
          _sum: { netPay: true },
        })
      )._sum.netPay ?? new Prisma.Decimal(0);
    const entries = await tx.payrollEntry.findMany({
      where: { payrollRunId: run.id, deletedAt: null },
    });
    if (entries.some((e) => e.netPay.lt(0)))
      throw new BadRequestException('Payroll entries cannot have negative net payments.');
    const payable = await tx.chartOfAccount.findFirst({
      where: {
        companyId: run.companyId,
        accountCode: '2270',
        accountType: 'LIABILITY',
        isActive: true,
        deletedAt: null,
        divisionId: null,
        branchId: null,
      },
    });
    if (
      !payable ||
      net.lte(0) ||
      !net.eq(run.totalNetPay) ||
      !accrual.lines
        .filter((l) => l.accountId === payable.id)
        .reduce((n, l) => n.plus(l.credit).minus(l.debit), new Prisma.Decimal(0))
        .eq(net)
    )
      throw new BadRequestException(
        'Net pay must agree with the reviewed Salaries Payable accrual (2270).',
      );
    const journal = await this.engine.postLines(
      {
        companyId: run.companyId,
        divisionId: cash.account.divisionId,
        branchId: cash.account.branchId,
        transactionDate: date,
        referenceType: 'PayrollRunPayment',
        referenceId: run.id,
        description: `Payroll payment — ${run.payrollRunNumber}`,
        journalNumber: `JE-PAY-${randomUUID()}`,
        userId: user.id,
        moduleName: 'payroll',
        lines: [
          { accountId: payable.id, debit: net, credit: 0 },
          { accountId: cash.ledger.id, debit: 0, credit: net },
        ],
      },
      tx,
    );
    const movement = await this.movement(tx, run, user, cash.account, {
      requestId: dto.requestId,
      key,
      date,
      amount: net.negated(),
      journalId: journal.id,
    });
    const numbers = new Map<string, string>();
    for (const entry of entries.filter((e) => e.netPay.gt(0)))
      numbers.set(
        entry.id,
        await this.codes.next({ companyId: run.companyId, entityType: 'SalaryPayment', tx }),
      );
    await tx.salaryPayment.createMany({
      data: entries
        .filter((e) => e.netPay.gt(0))
        .map((e) => ({
          salaryPaymentNumber: numbers.get(e.id)!,
          companyId: run.companyId,
          payrollRunId: run.id,
          payrollEntryId: e.id,
          employeeId: e.employeeId,
          amount: e.netPay,
          currency: cash.account.currency,
          paymentDate: date,
          cashAccountId: cash.account.erpCashAccountId,
          cashMovementId: movement.id,
          reference: run.payrollRunNumber,
          status: 'PAID' as const,
          paidById: user.id,
          paymentMethod:
            cash.account.kind === 'CASH'
              ? SalaryPaymentMethod.CASH
              : cash.account.kind === 'MOBILE_MONEY'
                ? SalaryPaymentMethod.MOBILE_MONEY
                : SalaryPaymentMethod.BANK_TRANSFER,
        })),
    });
    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'PAID',
        paidById: user.id,
        paidAt: new Date(),
        disbursingChartOfAccountId: cash.ledger.id,
        paymentJournalEntryId: journal.id,
      },
    });
    return { duplicate: false, movement };
  }

  async reverse(tx: Tx, run: PayrollRun, user: AuthUser, dto: ReversePayrollPaymentDto) {
    const original = await tx.cashDeskMovement.findUnique({
      where: { id: dto.movementId },
      include: { entries: true, payrollJournalEntry: { include: { lines: true } }, reversal: true },
    });
    if (
      !original ||
      original.payrollRunId !== run.id ||
      original.reversalOfId ||
      original.kind !== 'PAYROLL_PAYMENT'
    )
      throw new NotFoundException(
        'Payroll payment not found. Historical unconnected payroll payments need reconciliation.',
      );
    const date = cashDate(dto.businessDate),
      reason = dto.reason.trim();
    const key = payloadKey({ movementId: original.id, businessDate: dto.businessDate, reason });
    if (original.reversedAt) {
      if (original.reversal?.payloadKey === key) return { duplicate: true };
      throw new ConflictException('This payroll payment has already been reversed.');
    }
    const journal = original.payrollJournalEntry;
    if (reason.length < 3 || date < original.businessDate)
      throw new BadRequestException('Enter a reason and a reversal date on or after the payment.');
    if (
      run.status !== 'PAID' ||
      run.paymentJournalEntryId !== journal?.id ||
      journal?.status !== 'POSTED' ||
      journal.deletedAt ||
      original.entries.length !== 1
    )
      throw new ConflictException(
        'Payroll payment evidence is inconsistent. Reconcile it before reversing.',
      );
    const cash = await this.account(tx, run.companyId, original.entries[0].accountId, user);
    const cashLine = journal.lines.find(
      (l) => l.accountId === cash.ledger.id && l.credit.eq(original.amount),
    );
    if (!cashLine || !original.entries[0].amount.eq(original.amount.negated()))
      throw new BadRequestException(
        'The original cash mapping or payment evidence has changed. Restore the connection before reversing.',
      );
    const reversal = await this.engine.postLines(
      {
        companyId: journal.companyId,
        divisionId: journal.divisionId,
        branchId: journal.branchId,
        transactionDate: date,
        referenceType: 'PayrollRunPayment',
        referenceId: run.id,
        description: `Payroll payment reversal — ${run.payrollRunNumber}: ${reason}`,
        journalNumber: `JE-PAY-REV-${randomUUID()}`,
        userId: user.id,
        moduleName: 'payroll',
        lines: journal.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          divisionId: l.divisionId,
          branchId: l.branchId,
        })),
      },
      tx,
    );
    await tx.journalEntry.update({
      where: { id: reversal.id },
      data: { reversalOfId: journal.id },
    });
    const claim = await tx.journalEntry.updateMany({
      where: { id: journal.id, status: 'POSTED', reversedAt: null },
      data: {
        status: 'REVERSED',
        reversedAt: new Date(),
        reversedById: user.id,
        reversalReason: reason,
      },
    });
    if (claim.count !== 1)
      throw new ConflictException('Payment journal changed. Reload before reversing.');
    await tx.cashDeskMovement.update({
      where: { id: original.id },
      data: { reversedAt: new Date(), reversalReason: reason },
    });
    await this.movement(tx, run, user, cash.account, {
      requestId: `payroll-reversal:${original.id}`,
      key,
      date,
      amount: original.amount,
      journalId: reversal.id,
      reversalOfId: original.id,
      reason,
    });
    await tx.salaryPayment.updateMany({
      where: { cashMovementId: original.id, status: 'PAID' },
      data: { status: 'REVERSED', notes: reason },
    });
    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'APPROVED',
        paidAt: null,
        paidById: null,
        paymentJournalEntryId: null,
        disbursingChartOfAccountId: null,
      },
    });
    return { duplicate: false };
  }

  private async account(tx: Tx, companyId: string, id: string, user: AuthUser) {
    await tx.$queryRaw`SELECT id FROM cash_desk_accounts WHERE id = ${id} FOR UPDATE`;
    const account = await tx.cashDeskAccount.findUnique({ where: { id } });
    if (!account || account.companyId !== companyId || !account.erpCashAccountId)
      throw new BadRequestException(
        'Choose a connected Cash Desk account belonging to the payroll company.',
      );
    await this.org.assertCanAccessScope(
      user,
      account.divisionId,
      account.branchId,
      AccessLevel.WRITE,
    );
    const profile = await tx.companyProfile.findUnique({ where: { companyId } });
    if (!profile || profile.currency !== account.currency)
      throw new BadRequestException(
        'Payroll and cash account must use the company accounting currency.',
      );
    const { cash, ledger } = await mappedCashAccount(
      tx,
      companyId,
      account.erpCashAccountId,
      account.currency,
    );
    if (
      (cash.divisionId && cash.divisionId !== account.divisionId) ||
      (cash.branchId && cash.branchId !== account.branchId)
    )
      throw new BadRequestException('Cash Desk and bank account scopes do not agree.');
    return { account, ledger };
  }

  private async movement(
    tx: Tx,
    run: PayrollRun,
    user: AuthUser,
    account: Prisma.CashDeskAccountGetPayload<object>,
    input: {
      requestId: string;
      key: string;
      date: Date;
      amount: Prisma.Decimal;
      journalId: string;
      reversalOfId?: string;
      reason?: string;
    },
  ) {
    if (input.date < account.openingDate)
      throw new BadRequestException('Payment cannot precede the cash account opening date.');
    const days = await tx.cashDeskEntry.groupBy({
      by: ['businessDate'],
      where: { accountId: account.id },
      _sum: { amount: true },
    });
    const balance = checkDailyBalances(
      days.map((r) => ({ businessDate: r.businessDate, amount: r._sum.amount! })),
      input.date,
      input.amount,
    );
    const movement = await tx.cashDeskMovement.create({
      data: {
        requestId: input.requestId,
        payloadKey: input.key,
        kind: input.reversalOfId ? 'REVERSAL' : 'PAYROLL_PAYMENT',
        payrollRunId: run.id,
        payrollJournalEntryId: input.journalId,
        amount: input.amount.abs(),
        currency: account.currency,
        businessDate: input.date,
        description:
          `${input.reversalOfId ? 'Payroll payment reversal' : 'Payroll payment'} — ${run.payrollRunNumber}${input.reason ? ': ' + input.reason : ''}`.slice(
            0,
            500,
          ),
        reference: run.payrollRunNumber.slice(0, 160),
        createdBy: user.id,
        actorName: user.fullName || user.email,
        reversalOfId: input.reversalOfId,
        entries: {
          create: { accountId: account.id, businessDate: input.date, amount: input.amount },
        },
      },
    });
    await tx.cashDeskAccount.update({
      where: { id: account.id },
      data: { balance, version: { increment: 1 } },
    });
    await this.audit.logStrictInTransaction(tx, {
      action: input.reversalOfId ? 'PAYROLL_PAYMENT_REVERSE' : 'PAYROLL_PAYMENT',
      entityType: 'PayrollRun',
      entityId: run.id,
      userId: user.id,
      companyId: run.companyId,
      newValue: {
        movementId: movement.id,
        journalEntryId: input.journalId,
        amount: input.amount.toFixed(2),
        reason: input.reason,
      },
    });
    return movement;
  }
}
