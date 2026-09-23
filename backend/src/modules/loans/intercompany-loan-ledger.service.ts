import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { LoanLedgerService } from './loan-ledger.service';
import { CashMovementDto } from '../cash-desk/cash-desk.dto';
import { PostingLine } from '../accounting-engine/posting-engine.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
type Tx = Prisma.TransactionClient;
@Injectable()
export class IntercompanyLoanLedgerService {
  constructor(
    private readonly ledger: LoanLedgerService,
    private readonly audit: AuditLogsService,
  ) {}
  async post(tx: Tx, user: AuthUser, movementId: string, dto: CashMovementDto) {
    this.ledger.permissions(user);
    const movement = await tx.cashDeskMovement.findUniqueOrThrow({
      where: { id: movementId },
      include: { loan: { include: { lender: true, borrower: true } }, entries: true },
    });
    const loan = movement.loan;
    if (
      !loan ||
      !['LOAN', 'LOAN_REPAYMENT'].includes(movement.kind) ||
      movement.entries.length !== 2
    )
      throw new BadRequestException('Intercompany loan evidence is incomplete.');
    if (
      await tx.journalEntry.count({
        where: { referenceType: 'DeskIntercompany', referenceId: movementId },
      })
    )
      throw new ConflictException('This intercompany movement is already posted.');
    const lender = loan.lender,
      borrower = loan.borrower;
    const companies = await tx.company.findMany({
      where: { id: { in: [lender.companyId, borrower.companyId] }, deletedAt: null },
      select: { id: true, groupId: true },
    });
    if (
      companies.length !== 2 ||
      !companies[0].groupId ||
      companies[0].groupId !== companies[1].groupId
    )
      throw new BadRequestException(
        'Intercompany lending requires two companies in the same group.',
      );
    const lenderScope = await this.ledger.scope(user, lender),
      borrowerScope = await this.ledger.scope(user, borrower);
    // The caller locks both Cash Desk accounts in id order before posting either company.
    const lenderCash = await this.ledger.cash(tx, user, lenderScope, loan.currency, lender.id),
      borrowerCash = await this.ledger.cash(tx, user, borrowerScope, loan.currency, borrower.id);
    const receivable = await this.ledger.account(
      tx,
      loan.receivableAccountId || dto.receivableAccountId,
      lenderScope,
      'ASSET',
    );
    const payable = await this.ledger.account(
      tx,
      loan.payableAccountId || dto.payableAccountId,
      borrowerScope,
      'LIABILITY',
    );
    if (receivable.id === lenderCash.ledger.id)
      throw new BadRequestException(
        'Intercompany receivable must be separate from the cash ledger.',
      );
    if (movement.kind === 'LOAN_REPAYMENT' && (!loan.receivableAccountId || !loan.payableAccountId))
      throw new BadRequestException(
        'Review the original intercompany loan ledger connection before repayment.',
      );
    const principal = movement.loanPrincipal || movement.amount,
      interest = movement.loanInterest || new Prisma.Decimal(0),
      fees = movement.loanFees || new Prisma.Decimal(0);
    if (!principal.plus(interest).plus(fees).eq(movement.amount))
      throw new BadRequestException('Intercompany payment allocation does not equal cash moved.');
    const repayment = movement.kind === 'LOAN_REPAYMENT';
    const lenderEntry = movement.entries.find((e) => e.accountId === lender.id),
      borrowerEntry = movement.entries.find((e) => e.accountId === borrower.id);
    if (
      !lenderEntry?.amount.eq(movement.amount.mul(repayment ? 1 : -1)) ||
      !borrowerEntry?.amount.eq(movement.amount.mul(repayment ? -1 : 1))
    )
      throw new BadRequestException('Intercompany cash entries do not agree.');
    const lenderLines: PostingLine[] = [
      {
        accountId: lenderCash.ledger.id,
        debit: repayment ? movement.amount : 0,
        credit: repayment ? 0 : movement.amount,
      },
    ];
    const borrowerLines: PostingLine[] = [
      {
        accountId: borrowerCash.ledger.id,
        debit: repayment ? 0 : movement.amount,
        credit: repayment ? movement.amount : 0,
      },
    ];
    if (principal.gt(0)) {
      lenderLines.push({
        accountId: receivable.id,
        debit: repayment ? 0 : principal,
        credit: repayment ? principal : 0,
        description: 'Intercompany principal',
      });
      borrowerLines.push({
        accountId: payable.id,
        debit: repayment ? principal : 0,
        credit: repayment ? 0 : principal,
        description: 'Intercompany principal',
      });
    }
    for (const charge of [
      {
        amount: interest,
        income: dto.interestIncomeAccountId,
        expense: dto.interestExpenseAccountId,
        label: 'Intercompany interest',
      },
      {
        amount: fees,
        income: dto.feeIncomeAccountId,
        expense: dto.feeExpenseAccountId,
        label: 'Intercompany fees',
      },
    ])
      if (charge.amount.gt(0)) {
        const income = await this.ledger.account(tx, charge.income, lenderScope, 'INCOME'),
          expense = await this.ledger.account(tx, charge.expense, borrowerScope, 'EXPENSE');
        lenderLines.push({
          accountId: income.id,
          debit: 0,
          credit: charge.amount,
          description: charge.label,
        });
        borrowerLines.push({
          accountId: expense.id,
          debit: charge.amount,
          credit: 0,
          description: charge.label,
        });
      }
    for (const side of [
      { scope: lenderScope, lines: lenderLines },
      { scope: borrowerScope, lines: borrowerLines },
    ].sort((a, b) => a.scope.companyId.localeCompare(b.scope.companyId))) {
      await this.ledger.post(
        tx,
        user,
        side.scope,
        movement.businessDate,
        movement.id,
        movement.description,
        side.lines,
        'DeskIntercompany',
      );
      await this.audit.logStrictInTransaction(tx, {
        action: 'INTERCOMPANY_LOAN_POSTED',
        entityType: 'CashDeskMovement',
        entityId: movement.id,
        companyId: side.scope.companyId,
        userId: user.id,
      });
    }
    if (movement.kind === 'LOAN')
      await tx.cashDeskLoan.update({
        where: { id: loan.id },
        data: { receivableAccountId: receivable.id, payableAccountId: payable.id },
      });
  }
  async reverse(
    tx: Tx,
    user: AuthUser,
    originalId: string,
    reversalId: string,
    date: Date,
    reason: string,
  ) {
    const journals = await tx.journalEntry.findMany({
      where: { referenceType: 'DeskIntercompany', referenceId: originalId },
      include: { lines: true },
      orderBy: { companyId: 'asc' },
    });
    if (!journals.length) return;
    this.ledger.permissions(user, true, true);
    if (
      journals.length !== 2 ||
      new Set(journals.map((j) => j.companyId)).size !== 2 ||
      journals.some((j) => j.status !== 'POSTED' || j.deletedAt || j.reversalOfId)
    )
      throw new ConflictException(
        'Both original company journals must be posted before reversing this loan movement.',
      );
    for (const original of journals) {
      const scope = await this.ledger.scope(user, original);
      const reversed = await this.ledger.post(
        tx,
        user,
        scope,
        date,
        reversalId,
        `Reversal · ${reason}`,
        original.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          description: l.description || undefined,
        })),
        'DeskIntercompany',
      );
      await tx.journalEntry.update({
        where: { id: original.id },
        data: {
          status: 'REVERSED',
          reversedById: user.id,
          reversedAt: new Date(),
          reversalReason: reason,
        },
      });
      await tx.journalEntry.update({
        where: { id: reversed.id },
        data: { reversalOfId: original.id },
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'INTERCOMPANY_LOAN_REVERSED',
        entityType: 'CashDeskMovement',
        entityId: reversalId,
        companyId: scope.companyId,
        userId: user.id,
      });
    }
  }
}
