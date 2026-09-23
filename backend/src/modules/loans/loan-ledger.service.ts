import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { PostingEngineService, PostingLine } from '../accounting-engine/posting-engine.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { mappedCashAccount } from '../../common/services/mapped-cash-account';
import { checkDailyBalances, payloadKey } from '../cash-desk/cash-desk.domain';

type Tx = Prisma.TransactionClient;
type Scope = { companyId: string; divisionId: string | null; branchId: string | null };
@Injectable()
export class LoanLedgerService {
  constructor(
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly engine: PostingEngineService,
    private readonly audit: AuditLogsService,
  ) {}
  permissions(user: AuthUser, cash = true, reverse = false) {
    const required = [
      'journal_entries.view',
      'journal_entries.create',
      'journal_entries.post',
      ...(cash ? ['cash_desk.view', 'cash_desk.record'] : []),
      ...(reverse ? ['journal_entries.reverse'] : []),
    ];
    if (!required.every((p) => user.permissions?.includes(p)))
      throw new ForbiddenException(
        'Loan posting requires journal posting and Cash Desk recording permissions; reversals also require journal reversal permission.',
      );
  }
  async readWhere(user: AuthUser, companyId?: string) {
    return {
      AND: [
        await this.companies.companyWhereFor(user, companyId),
        await this.org.recordWhereFor(user),
      ],
    };
  }
  async scope(
    user: AuthUser,
    record: { companyId: string | null; divisionId: string | null; branchId: string | null },
    write = true,
  ) {
    if (!record.companyId)
      throw new BadRequestException('Select the accounting company that holds this loan.');
    await this.companies.assertCanAccessCompany(
      user,
      record.companyId,
      write ? AccessLevel.WRITE : AccessLevel.READ,
    );
    await this.org.assertCanAccessScope(
      user,
      record.divisionId,
      record.branchId,
      write ? AccessLevel.WRITE : AccessLevel.READ,
    );
    return record as Scope;
  }
  async account(tx: Tx, id: string | undefined | null, scope: Scope, type: string) {
    const account = id ? await tx.chartOfAccount.findUnique({ where: { id } }) : null;
    if (
      !account ||
      !account.isActive ||
      account.deletedAt ||
      account.companyId !== scope.companyId ||
      account.accountType !== type ||
      (account.divisionId && account.divisionId !== scope.divisionId) ||
      (account.branchId && account.branchId !== scope.branchId)
    )
      throw new BadRequestException(
        `Choose an active ${type.toLowerCase()} ledger account in the same company and organisation.`,
      );
    return account;
  }
  async currency(tx: Tx, companyId: string, currency: string) {
    const profile = await tx.companyProfile.findUnique({ where: { companyId } });
    if (!profile || profile.currency !== currency)
      throw new BadRequestException(
        'Loan and cash currency must match the company accounting currency.',
      );
  }
  async cash(tx: Tx, user: AuthUser, scope: Scope, currency: string, accountId: string) {
    if (!accountId) throw new BadRequestException('Choose a connected Cash Desk account.');
    await tx.$queryRaw`SELECT id FROM cash_desk_accounts WHERE id = ${accountId} FOR UPDATE`;
    const account = await tx.cashDeskAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Cash Desk account not found.');
    await this.scope(user, account);
    if (
      account.companyId !== scope.companyId ||
      account.currency !== currency ||
      (scope.divisionId && account.divisionId !== scope.divisionId) ||
      (scope.branchId && account.branchId !== scope.branchId) ||
      !account.erpCashAccountId
    )
      throw new BadRequestException(
        'Choose a connected Cash Desk account in the loan company, organisation and currency.',
      );
    const mapping = await mappedCashAccount(
      tx,
      account.companyId,
      account.erpCashAccountId,
      currency,
    );
    if (
      (mapping.cash.divisionId && mapping.cash.divisionId !== account.divisionId) ||
      (mapping.cash.branchId && mapping.cash.branchId !== account.branchId)
    )
      throw new BadRequestException('Cash Desk and bank account scopes do not agree.');
    await this.currency(tx, scope.companyId, currency);
    return { account, ledger: mapping.ledger };
  }
  async movement(
    tx: Tx,
    user: AuthUser,
    cash: Awaited<ReturnType<LoanLedgerService['cash']>>,
    input: {
      requestId: string;
      kind: string;
      date: Date;
      amount: Prisma.Decimal;
      description: string;
      reference: string;
      reversalOfId?: string;
    },
  ) {
    if (input.date < cash.account.openingDate)
      throw new BadRequestException('Loan movement cannot precede the cash account opening date.');
    const daily = await tx.cashDeskEntry.groupBy({
      by: ['businessDate'],
      where: { accountId: cash.account.id },
      _sum: { amount: true },
    });
    const balance = checkDailyBalances(
      daily.map((r) => ({ businessDate: r.businessDate, amount: r._sum.amount! })),
      input.date,
      input.amount,
    );
    const movement = await tx.cashDeskMovement.create({
      data: {
        requestId: input.requestId,
        payloadKey: payloadKey({ ...input, accountId: cash.account.id }),
        kind: input.kind,
        businessDate: input.date,
        amount: input.amount.abs(),
        currency: cash.account.currency,
        description: input.description.slice(0, 500),
        reference: input.reference.slice(0, 160),
        createdBy: user.id,
        actorName: user.fullName || user.email,
        reversalOfId: input.reversalOfId,
      },
    });
    await tx.cashDeskEntry.create({
      data: {
        movementId: movement.id,
        accountId: cash.account.id,
        businessDate: input.date,
        amount: input.amount,
      },
    });
    await tx.cashDeskAccount.update({
      where: { id: cash.account.id },
      data: { balance, version: { increment: 1 } },
    });
    await this.audit.logStrictInTransaction(tx, {
      action: 'LOAN_CASH_MOVEMENT',
      entityType: 'CashDeskMovement',
      entityId: movement.id,
      companyId: cash.account.companyId,
      userId: user.id,
    });
    return movement;
  }
  async post(
    tx: Tx,
    user: AuthUser,
    scope: Scope,
    date: Date,
    referenceId: string,
    description: string,
    lines: PostingLine[],
    referenceType = 'LoanLifecycle',
  ) {
    return this.engine.postLines(
      {
        companyId: scope.companyId,
        divisionId: scope.divisionId,
        branchId: scope.branchId,
        transactionDate: date,
        description,
        referenceType,
        referenceId,
        userId: user.id,
        moduleName: 'loans',
        journalNumber: `JE-LOAN-${randomUUID()}`,
        status: 'POSTED',
        lines,
      },
      tx,
    );
  }
}
