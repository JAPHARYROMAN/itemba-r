import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, CashDeskAccount, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InvoiceDeskService } from '../invoice-desk/invoice-desk.service';
import { deskKey, positiveAmount, todayUtc } from '../invoice-desk/invoice-desk.domain';
import {
  CashAccountDto,
  CashExpenseQuery,
  CashMovementDto,
  CashQuery,
  CashReverseDto,
} from './cash-desk.dto';
import { cashDate, checkDailyBalances, payloadKey } from './cash-desk.domain';
import { CashConnectionsService } from '../desk-reports/cash-connections.service';
import { IntercompanyLoanLedgerService } from '../loans/intercompany-loan-ledger.service';
import { allocateLoanPayment } from '../loans/loan-allocation';

const names = {
  company: { select: { name: true } },
  division: { select: { name: true } },
  branch: { select: { name: true } },
} as const;
const party = {
  id: true,
  name: true,
  companyId: true,
  currency: true,
  company: { select: { name: true } },
} as const;

@Injectable()
export class CashDeskService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly audit: AuditLogsService,
    private readonly invoices: InvoiceDeskService,
    private readonly connections?: CashConnectionsService,
    private readonly intercompany?: IntercompanyLoanLedgerService,
  ) {}

  directory(user: AuthUser) {
    return this.invoices.directory(user);
  }
  private async scope(
    user: AuthUser,
    q: CashQuery = { page: 1 },
  ): Promise<Prisma.CashDeskAccountWhereInput> {
    return {
      AND: [
        await this.companies.companyWhereFor(user, q.companyId),
        await this.org.recordWhereFor(user),
        { divisionId: q.divisionId, branchId: q.branchId, id: q.accountId },
      ],
    };
  }
  async accounts(user: AuthUser, q: CashQuery) {
    return this.db.cashDeskAccount.findMany({
      where: await this.scope(user, q),
      include: names,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
  private async writable(user: AuthUser, id: string) {
    const row = await this.db.cashDeskAccount.findFirst({
      where: { AND: [{ id }, await this.scope(user)] },
    });
    if (!row) throw new NotFoundException('Cash account not found.');
    await this.companies.assertCanAccessCompany(user, row.companyId, AccessLevel.WRITE);
    await this.org.assertCanAccessScope(user, row.divisionId, row.branchId, AccessLevel.WRITE);
    return row;
  }
  private invoicePermission(user: AuthUser) {
    if (!['invoice_desk.view', 'invoice_desk.payments'].every((p) => user.permissions.includes(p)))
      throw new ForbiddenException('Invoice Desk view and payment permissions are required.');
  }
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.db.$transaction(work, { timeout: 20000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(e.code))
        throw new ConflictException(
          'This record already exists or changed while saving. Refresh before trying again.',
        );
      throw e;
    }
  }
  private async auditMovement(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    id: string,
    accounts: CashDeskAccount[],
    action: string,
  ) {
    for (const companyId of new Set(accounts.map((a) => a.companyId)))
      await this.audit.logStrictInTransaction(tx, {
        action: `CASH_DESK_${action}`,
        entityType: 'CashDeskMovement',
        entityId: id,
        companyId,
        userId: user.id,
      });
  }
  private async existing(
    tx: Prisma.TransactionClient,
    requestId: string,
    key: string,
    user: AuthUser,
  ) {
    const row = await tx.cashDeskMovement.findUnique({ where: { requestId } });
    if (row && (row.payloadKey !== key || row.createdBy !== user.id))
      throw new ConflictException('This request reference was already used.');
    return row;
  }
  private async lockAccounts(tx: Prisma.TransactionClient, accounts: CashDeskAccount[]) {
    for (const account of [...accounts].sort((a, b) => a.id.localeCompare(b.id))) {
      const locked = await tx.cashDeskAccount.updateMany({
        where: { id: account.id, version: account.version },
        data: { version: { increment: 1 } },
      });
      if (locked.count !== 1)
        throw new ConflictException('An account changed. Refresh its balance before trying again.');
    }
  }
  private async entries(
    tx: Prisma.TransactionClient,
    movementId: string,
    date: Date,
    deltas: { account: CashDeskAccount; amount: Prisma.Decimal }[],
  ) {
    for (const { account, amount } of deltas) {
      if (date < account.openingDate)
        throw new BadRequestException('A movement cannot precede the account opening date.');
      const daily = await tx.cashDeskEntry.groupBy({
        by: ['businessDate'],
        where: { accountId: account.id },
        _sum: { amount: true },
      });
      const balance = checkDailyBalances(
        daily.map((r) => ({ businessDate: r.businessDate, amount: r._sum.amount! })),
        date,
        amount,
      );
      await tx.cashDeskEntry.create({
        data: { movementId, accountId: account.id, businessDate: date, amount },
      });
      await tx.cashDeskAccount.update({ where: { id: account.id }, data: { balance } });
    }
  }
  async createAccount(user: AuthUser, d: CashAccountDto) {
    await this.companies.assertCanAccessCompany(user, d.companyId, AccessLevel.WRITE);
    await this.org.assertCanAccessScope(user, d.divisionId, d.branchId, AccessLevel.WRITE);
    const branch = await this.db.branch.findFirst({
      where: {
        id: d.branchId,
        divisionId: d.divisionId,
        isActive: true,
        deletedAt: null,
        division: {
          companyId: d.companyId,
          isActive: true,
          deletedAt: null,
          company: { status: 'ACTIVE', deletedAt: null },
        },
      },
    });
    if (!branch || !d.name.trim())
      throw new BadRequestException(
        'Choose an active company, division and branch, and enter an account name.',
      );
    const date = cashDate(d.openingDate),
      amount = new Prisma.Decimal(d.openingBalance);
    if (amount.lt(0) || amount.gte('10000000000000000') || amount.decimalPlaces() > 2)
      throw new BadRequestException('Enter a valid opening balance.');
    return this.transaction(async (tx) => {
      const account = await tx.cashDeskAccount.create({
        data: {
          companyId: d.companyId,
          divisionId: d.divisionId,
          branchId: d.branchId,
          name: d.name.trim(),
          nameKey: deskKey(d.name),
          kind: d.kind,
          currency: d.currency,
          openingDate: date,
        },
      });
      if (amount.gt(0)) {
        const movement = await tx.cashDeskMovement.create({
          data: {
            requestId: d.requestId,
            payloadKey: payloadKey(d),
            kind: 'OPENING',
            amount,
            currency: d.currency,
            businessDate: date,
            description: `Opening balance · ${account.name}`,
            reference: '',
            createdBy: user.id,
            actorName: user.fullName || user.email,
          },
        });
        await this.entries(tx, movement.id, date, [{ account, amount }]);
      }
      await this.audit.logStrictInTransaction(tx, {
        action: 'CASH_DESK_ACCOUNT_CREATED',
        entityType: 'CashDeskAccount',
        entityId: account.id,
        companyId: d.companyId,
        userId: user.id,
        newValue: { name: account.name, currency: d.currency, openingBalance: amount.toFixed(2) },
      });
      return tx.cashDeskAccount.findUniqueOrThrow({ where: { id: account.id } });
    });
  }
  async record(user: AuthUser, d: CashMovementDto) {
    const account = await this.writable(user, d.accountId),
      amount = positiveAmount(d.amount),
      date = cashDate(d.businessDate);
    const key = payloadKey(d),
      two = ['TRANSFER', 'LOAN', 'LOAN_REPAYMENT'].includes(d.kind);
    if (!d.description.trim()) throw new BadRequestException('Describe this movement.');
    if (
      d.kind !== 'LOAN_REPAYMENT' &&
      [
        d.principal,
        d.interest,
        d.fees,
        d.interestIncomeAccountId,
        d.interestExpenseAccountId,
        d.feeIncomeAccountId,
        d.feeExpenseAccountId,
      ].some((v) => v !== undefined)
    )
      throw new BadRequestException(
        'Loan charge allocations are only used for intercompany repayments.',
      );
    if (
      d.kind !== 'LOAN' &&
      [d.receivableAccountId, d.payableAccountId].some((v) => v !== undefined)
    )
      throw new BadRequestException(
        'Principal control accounts are set on the original intercompany loan.',
      );
    if (
      d.kind !== 'EXPENSE' &&
      [d.expenseCategory, d.payee, d.expenseNotes].some((v) => v !== undefined)
    )
      throw new BadRequestException('Expense details can only be added to an expense.');
    if (d.payee !== undefined && !d.payee.trim())
      throw new BadRequestException('Enter who was paid.');
    if (
      two !== !!d.targetAccountId ||
      (d.kind === 'LOAN_REPAYMENT') !== !!d.loanId ||
      (d.kind === 'SUPPLIER_PAYMENT') !== !!d.invoiceId ||
      (d.kind !== 'LOAN' && !!d.dueDate) ||
      (d.kind !== 'SUPPLIER_PAYMENT' &&
        (d.invoiceVersion !== undefined || !!d.existingInvoicePaymentId))
    )
      throw new BadRequestException(
        'Select only the accounts, loan or invoice required for this movement.',
      );
    const target = d.targetAccountId ? await this.writable(user, d.targetAccountId) : undefined;
    if (target && (target.id === account.id || target.currency !== account.currency))
      throw new BadRequestException('Choose different accounts in the same currency.');
    if (d.kind === 'TRANSFER' && target?.companyId !== account.companyId)
      throw new BadRequestException('Use an intercompany loan to move money between companies.');
    if (d.kind === 'LOAN') {
      if (target?.companyId === account.companyId)
        throw new BadRequestException('Choose a borrower in another company.');
      const companies = await this.db.company.findMany({
        where: { id: { in: [account.companyId, target!.companyId] } },
        select: { groupId: true },
      });
      if (companies.length !== 2 || companies[0].groupId !== companies[1].groupId)
        throw new BadRequestException('Both companies must belong to the same group.');
      if (d.dueDate && new Date(d.dueDate) < date)
        throw new BadRequestException('Repayment due date cannot precede the loan date.');
    }
    if (d.kind === 'SUPPLIER_PAYMENT') this.invoicePermission(user);
    return this.transaction(async (tx) => {
      const existing = await this.existing(tx, d.requestId, key, user);
      if (existing) return existing;
      const accounts = target ? [account, target] : [account];
      await this.lockAccounts(tx, accounts);
      if (
        d.kind === 'DAILY_SALES' &&
        (await tx.cashDeskMovement.count({
          where: {
            kind: 'SALE_RECEIPT',
            businessDate: date,
            reversedAt: null,
            entries: { some: { accountId: account.id } },
          },
        }))
      )
        throw new ConflictException(
          'Sales Desk receipts already cover this account and date. Record the remaining sales in Sales Desk to avoid counting receipts twice.',
        );
      let loanId = d.loanId,
        invoicePaymentId: string | undefined;
      let loanAllocation: ReturnType<typeof allocateLoanPayment> | undefined;
      if (d.kind === 'LOAN') {
        const loan = await tx.cashDeskLoan.create({
          data: {
            lenderAccountId: account.id,
            borrowerAccountId: target!.id,
            currency: account.currency,
            principal: amount,
            outstanding: amount,
            loanDate: date,
            dueDate: d.dueDate ? new Date(d.dueDate) : null,
            description: d.description.trim(),
          },
        });
        loanId = loan.id;
      }
      if (d.kind === 'LOAN_REPAYMENT') {
        const loan = await tx.cashDeskLoan.findUnique({ where: { id: loanId } });
        if (
          !loan ||
          loan.voidedAt ||
          loan.borrowerAccountId !== account.id ||
          loan.lenderAccountId !== target!.id
        )
          throw new BadRequestException(
            'Select the original borrower and lender accounts for this loan.',
          );
        loanAllocation = allocateLoanPayment(d, loan.outstanding);
        if (date < loan.loanDate)
          throw new BadRequestException('Check the repayment date and remaining loan balance.');
        const changed = await tx.cashDeskLoan.updateMany({
          where: { id: loan.id, version: loan.version },
          data: { outstanding: { decrement: loanAllocation.principal }, version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ConflictException('This loan changed. Refresh and try again.');
      }
      if (d.kind === 'SUPPLIER_PAYMENT') {
        const invoice = await this.invoices.detail(user, d.invoiceId!);
        if (invoice.companyId !== account.companyId || invoice.currency !== account.currency)
          throw new BadRequestException(
            'The invoice and paying account must use the same company and currency.',
          );
        if (d.existingInvoicePaymentId) {
          await this.companies.assertCanAccessCompany(user, invoice.companyId, AccessLevel.WRITE);
          await this.org.assertCanAccessScope(
            user,
            invoice.divisionId,
            invoice.branchId,
            AccessLevel.WRITE,
          );
          await tx.$queryRaw`SELECT id FROM invoice_desk_invoices WHERE id = ${invoice.id} FOR UPDATE`;
          const payment = await tx.invoiceDeskPayment.findFirst({
            where: { id: d.existingInvoicePaymentId, invoiceId: invoice.id, reversedAt: null },
          });
          if (
            !payment ||
            !payment.amount.eq(amount) ||
            payment.paymentDate.getTime() !== date.getTime()
          )
            throw new ConflictException(
              'The existing payment changed. Use its original amount and payment date.',
            );
          if (await tx.cashDeskMovement.findUnique({ where: { invoicePaymentId: payment.id } }))
            throw new ConflictException('This payment is already linked to Cash Desk.');
          invoicePaymentId = payment.id;
        } else {
          if (!d.invoiceVersion)
            throw new BadRequestException('Refresh the invoice before recording payment.');
          if (await tx.invoiceDeskPayment.findUnique({ where: { requestId: d.requestId } }))
            throw new ConflictException('This payment request already belongs to Invoice Desk.');
          const payment = await this.invoices.paymentInTransaction(tx, user, invoice.id, {
            requestId: d.requestId,
            amount: d.amount,
            paymentDate: d.businessDate,
            version: d.invoiceVersion,
            method:
              account.kind === 'CASH'
                ? 'Cash'
                : account.kind === 'BANK'
                  ? 'Bank transfer'
                  : 'Mobile money',
            reference: d.reference,
          });
          invoicePaymentId = payment.id;
        }
      }
      const movement = await tx.cashDeskMovement.create({
        data: {
          requestId: d.requestId,
          payloadKey: key,
          kind: d.kind,
          expenseCategory: d.kind === 'EXPENSE' ? d.expenseCategory || 'OTHER' : null,
          payee: d.kind === 'EXPENSE' ? d.payee?.trim() || null : null,
          expenseNotes: d.kind === 'EXPENSE' ? d.expenseNotes?.trim() || null : null,
          amount,
          currency: account.currency,
          businessDate: date,
          description: d.description.trim(),
          reference: d.reference.trim(),
          createdBy: user.id,
          actorName: user.fullName || user.email,
          loanId,
          loanPrincipal: d.kind === 'LOAN' ? amount : loanAllocation?.principal,
          loanInterest: loanAllocation?.interest,
          loanFees: loanAllocation?.fees,
          invoicePaymentId,
          dailySalesKey: d.kind === 'DAILY_SALES' ? `${account.id}:${d.businessDate}` : null,
        },
      });
      const incoming = ['DAILY_SALES', 'OTHER_IN'].includes(d.kind);
      await this.entries(tx, movement.id, date, [
        { account, amount: incoming ? amount : amount.negated() },
        ...(target ? [{ account: target, amount }] : []),
      ]);
      await this.auditMovement(tx, user, movement.id, accounts, d.kind);
      if (['LOAN', 'LOAN_REPAYMENT'].includes(d.kind)) {
        if (!this.intercompany)
          throw new BadRequestException('Intercompany accounting is unavailable.');
        await this.intercompany.post(tx, user, movement.id, d);
      }
      return movement;
    });
  }
  async movements(user: AuthUser, q: CashQuery) {
    const scope = await this.scope(user, q),
      where: Prisma.CashDeskMovementWhereInput = {
        AND: [
          { entries: { some: { account: scope } } },
          {
            kind: q.kind === 'SALES_INCOME' ? { in: ['DAILY_SALES', 'SALE_RECEIPT'] } : q.kind,
            businessDate: q.date ? new Date(q.date) : undefined,
          },
          q.search
            ? {
                OR: [
                  { description: { contains: q.search, mode: 'insensitive' } },
                  { reference: { contains: q.search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      };
    const [rows, total] = await this.db.$transaction(
      [
        this.db.cashDeskMovement.findMany({
          where,
          include: {
            entries: { where: { account: scope }, include: { account: { select: party } } },
            loanFinancialEvent: { select: { loanId: true, id: true } },
          },
          orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: 25,
          skip: ((q.page || 1) - 1) * 25,
        }),
        this.db.cashDeskMovement.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { rows, total, page: q.page || 1, pageSize: 25 };
  }
  async movement(user: AuthUser, id: string) {
    const scope = await this.scope(user);
    const row = await this.db.cashDeskMovement.findFirst({
      where: { id, entries: { some: { account: scope } } },
      include: {
        entries: { where: { account: scope }, include: { account: { select: party } } },
        loanFinancialEvent: { select: { loanId: true, id: true } },
      },
    });
    if (!row) throw new NotFoundException('Cash movement not found.');
    return row;
  }
  async loan(user: AuthUser, id: string) {
    const scope = await this.scope(user);
    const row = await this.db.cashDeskLoan.findFirst({
      where: { id, OR: [{ lender: scope }, { borrower: scope }] },
      include: { lender: { select: party }, borrower: { select: party } },
    });
    if (!row) throw new NotFoundException('Intercompany loan not found.');
    return row;
  }
  async expenses(user: AuthUser, q: CashExpenseQuery) {
    if (q.from && q.to && q.from > q.to)
      throw new BadRequestException('The start date must be on or before the end date.');
    const scope = await this.scope(user, q);
    const where: Prisma.CashDeskMovementWhereInput = {
      AND: [
        { kind: 'EXPENSE', entries: { some: { account: scope } } },
        {
          businessDate: {
            gte: q.from ? new Date(q.from) : undefined,
            lte: q.to ? new Date(q.to) : undefined,
          },
          expenseCategory: q.expenseCategory === 'UNCATEGORIZED' ? null : q.expenseCategory,
          ...(q.status === 'paid'
            ? { reversedAt: null }
            : q.status === 'reversed'
              ? { reversedAt: { not: null } }
              : {}),
        },
        q.search?.trim()
          ? {
              OR: ['description', 'reference', 'payee', 'expenseNotes'].map((field) => ({
                [field]: { contains: q.search!.trim(), mode: 'insensitive' },
              })),
            }
          : {},
      ],
    };
    const groupedExpenses = this.db.cashDeskMovement.groupBy({
      by: ['currency', 'expenseCategory', 'reversedAt'],
      where,
      _sum: { amount: true },
      _count: true,
    });
    const [rows, total, groups] = await this.db.$transaction(
      [
        this.db.cashDeskMovement.findMany({
          where,
          include: {
            entries: { where: { account: scope }, include: { account: { select: party } } },
          },
          orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: 25,
          skip: ((q.page || 1) - 1) * 25,
        }),
        this.db.cashDeskMovement.count({ where }),
        groupedExpenses,
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const totals = new Map<
      string,
      {
        currency: string;
        paid: Prisma.Decimal;
        reversed: Prisma.Decimal;
        count: number;
        categories: Record<string, Prisma.Decimal>;
      }
    >();
    for (const group of groups) {
      const value = totals.get(group.currency) ?? {
        currency: group.currency,
        paid: new Prisma.Decimal(0),
        reversed: new Prisma.Decimal(0),
        count: 0,
        categories: {},
      };
      value.count += group._count;
      if (group.reversedAt) value.reversed = value.reversed.plus(group._sum.amount!);
      else {
        value.paid = value.paid.plus(group._sum.amount!);
        const category = group.expenseCategory ?? 'UNCATEGORIZED';
        value.categories[category] = (value.categories[category] ?? new Prisma.Decimal(0)).plus(
          group._sum.amount!,
        );
      }
      totals.set(group.currency, value);
    }
    return {
      rows,
      total,
      page: q.page || 1,
      pageSize: 25,
      currencies: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    };
  }
  async loans(user: AuthUser, q: CashQuery) {
    const scope = await this.scope(user, q);
    const where = { OR: [{ lender: scope }, { borrower: scope }] };
    const [rows, total] = await this.db.$transaction([
      this.db.cashDeskLoan.findMany({
        where,
        include: { lender: { select: party }, borrower: { select: party } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        skip: ((q.page || 1) - 1) * 25,
      }),
      this.db.cashDeskLoan.count({ where }),
    ]);
    return { rows, total, page: q.page || 1, pageSize: 25 };
  }
  async overview(user: AuthUser, q: CashQuery) {
    const scope = await this.scope(user, q),
      date = q.date ? new Date(q.date) : todayUtc();
    return this.db.$transaction(
      async (tx) => {
        const balances = await tx.cashDeskAccount.groupBy({
          by: ['currency'],
          where: scope,
          _sum: { balance: true },
          _count: true,
        });
        const sales = await tx.cashDeskEntry.findMany({
          where: {
            account: scope,
            businessDate: date,
            movement: { kind: { in: ['DAILY_SALES', 'SALE_RECEIPT'] }, reversedAt: null },
          },
          select: { amount: true, account: { select: { currency: true } } },
        });
        return {
          date,
          currencies: balances.map((b) => ({
            currency: b.currency,
            balance: b._sum.balance,
            accounts: b._count,
            sales: sales
              .filter((s) => s.account.currency === b.currency)
              .reduce((sum, s) => sum.plus(s.amount), new Prisma.Decimal(0)),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async reverse(user: AuthUser, id: string, d: CashReverseDto) {
    const original = await this.db.cashDeskMovement.findFirst({
      where: { id, entries: { some: { account: await this.scope(user) } } },
      include: {
        entries: true,
        invoicePayment: true,
        salesPayment: true,
        loanFinancialEvent: true,
      },
    });
    if (!original) throw new NotFoundException('Movement not found.');
    if (original.payrollRunId)
      throw new BadRequestException(
        'Reverse this payment in Payroll so cash, payroll and journal balances stay together.',
      );
    if (original.loanFinancialEvent)
      throw new BadRequestException(
        'Reverse this payment from the loan financial history so principal, schedules, cash and accounting stay together.',
      );
    if (original.kind === 'REVERSAL')
      throw new BadRequestException(
        'A reversal cannot be reversed. Record a new corrected movement.',
      );
    const date = cashDate(d.businessDate),
      key = payloadKey({ id, ...d });
    if (date < original.businessDate || d.reason.trim().length < 3)
      throw new BadRequestException(
        'Enter a reason and a reversal date on or after the original movement.',
      );
    const accounts = await Promise.all(
      original.entries.map((e) => this.writable(user, e.accountId)),
    );
    if (original.invoicePaymentId) this.invoicePermission(user);
    let salesRecord: { id: string; companyId: string; version: number } | null = null;
    if (original.salesPayment) {
      if (!['sales_desk.view', 'sales_desk.payments'].every((p) => user.permissions.includes(p)))
        throw new ForbiddenException('Sales Desk view and payment permissions are required.');
      const sale = await this.db.salesDeskSale.findFirst({
        where: {
          AND: [
            { id: original.salesPayment.saleId },
            await this.companies.companyWhereFor(user),
            await this.org.recordWhereFor(user),
          ],
        },
      });
      if (!sale) throw new NotFoundException('Sale not found.');
      await this.companies.assertCanAccessCompany(user, sale.companyId, AccessLevel.WRITE);
      await this.org.assertCanAccessScope(user, sale.divisionId, sale.branchId, AccessLevel.WRITE);
      salesRecord = sale;
    }
    return this.transaction(async (tx) => {
      const existing = await this.existing(tx, d.requestId, key, user);
      if (existing) return existing;
      // Sales payments and reversals lock the sale before its cash account.
      if (salesRecord && original.salesPayment) {
        const changed = await tx.salesDeskSale.updateMany({
          where: {
            id: salesRecord.id,
            version: salesRecord.version,
            voidedAt: null,
            paidAmount: { gte: original.amount },
          },
          data: { version: { increment: 1 }, paidAmount: { decrement: original.amount } },
        });
        if (changed.count !== 1)
          throw new ConflictException('This sale changed. Refresh before reversing payment.');
        const payment = await tx.salesDeskPayment.updateMany({
          where: { id: original.salesPayment.id, reversedAt: null },
          data: { reversedAt: new Date(), reversalReason: d.reason.trim() },
        });
        if (payment.count !== 1)
          throw new ConflictException('This sales payment is already reversed.');
        await tx.salesDeskEvent.create({
          data: {
            saleId: salesRecord.id,
            actorId: user.id,
            actorName: user.fullName || user.email,
            action: 'PAYMENT_REVERSED',
            detail: `${original.currency} ${original.amount.toFixed(2)} · ${d.reason.trim()}`,
          },
        });
        await this.audit.logStrictInTransaction(tx, {
          action: 'SALES_DESK_PAYMENT_REVERSED',
          entityType: 'SalesDeskSale',
          entityId: salesRecord.id,
          companyId: salesRecord.companyId,
          userId: user.id,
          metadata: { reason: d.reason.trim() },
        });
      }
      await this.lockAccounts(tx, accounts);
      const claimed = await tx.cashDeskMovement.updateMany({
        where: { id, reversedAt: null },
        data: { reversedAt: new Date(), reversalReason: d.reason.trim(), dailySalesKey: null },
      });
      if (claimed.count !== 1) throw new ConflictException('This movement is already reversed.');
      if (original.loanId) {
        const loan = await tx.cashDeskLoan.findUniqueOrThrow({ where: { id: original.loanId } });
        if (
          original.kind === 'LOAN' &&
          (!loan.outstanding.eq(loan.principal) ||
            (await tx.cashDeskMovement.count({
              where: { loanId: loan.id, kind: 'LOAN_REPAYMENT', reversedAt: null },
            })))
        )
          throw new BadRequestException('Reverse active repayments before reversing the loan.');
        if (loan.voidedAt) throw new ConflictException('This loan has been reversed.');
        const changed = await tx.cashDeskLoan.updateMany({
          where: { id: loan.id, version: loan.version },
          data:
            original.kind === 'LOAN'
              ? { voidedAt: new Date(), outstanding: 0, version: { increment: 1 } }
              : {
                  outstanding: { increment: original.loanPrincipal ?? original.amount },
                  version: { increment: 1 },
                },
        });
        if (changed.count !== 1)
          throw new ConflictException('This loan changed. Refresh and try again.');
      }
      if (original.invoicePayment) {
        const invoice = await tx.invoiceDeskInvoice.findUniqueOrThrow({
          where: { id: original.invoicePayment.invoiceId },
        });
        await this.invoices.reverseInTransaction(
          tx,
          user,
          invoice.id,
          original.invoicePayment.id,
          { version: invoice.version, reason: d.reason },
          true,
        );
      }
      const reversal = await tx.cashDeskMovement.create({
        data: {
          requestId: d.requestId,
          payloadKey: key,
          kind: 'REVERSAL',
          amount: original.amount,
          currency: original.currency,
          businessDate: date,
          description: d.reason.trim(),
          reference: original.reference,
          createdBy: user.id,
          actorName: user.fullName || user.email,
          reversalOfId: id,
        },
      });
      await this.entries(
        tx,
        reversal.id,
        date,
        original.entries.map((e) => ({
          account: accounts.find((a) => a.id === e.accountId)!,
          amount: e.amount.negated(),
        })),
      );
      await this.auditMovement(tx, user, reversal.id, accounts, 'REVERSED');
      await this.connections?.reverseInTransaction(
        tx,
        user,
        id,
        reversal.id,
        date,
        d.reason.trim(),
      );
      if (original.loanId) {
        if (!this.intercompany)
          throw new BadRequestException('Intercompany accounting is unavailable.');
        await this.intercompany.reverse(tx, user, id, reversal.id, date, d.reason.trim());
      }
      return reversal;
    });
  }

  async receiveSalesPayment(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    sale: { id: string; companyId: string; currency: string; saleNumber: string },
    payment: {
      id: string;
      requestId: string;
      amount: Prisma.Decimal;
      paymentDate: Date;
      reference: string;
    },
    accountId: string,
  ) {
    if (!['cash_desk.view', 'cash_desk.record'].every((p) => user.permissions.includes(p)))
      throw new ForbiddenException(
        'Cash Desk view and recording permissions are required to receive payment.',
      );
    const account = await this.writable(user, accountId);
    if (account.companyId !== sale.companyId || account.currency !== sale.currency)
      throw new BadRequestException(
        'Choose a receiving account in the same company and currency as the sale.',
      );
    await this.lockAccounts(tx, [account]);
    if (
      await tx.cashDeskMovement.count({
        where: {
          kind: 'DAILY_SALES',
          businessDate: payment.paymentDate,
          reversedAt: null,
          entries: { some: { accountId } },
        },
      })
    )
      throw new ConflictException(
        'A manual daily sales total already covers this account and date. Reverse that total before entering individual Sales Desk receipts.',
      );
    const movement = await tx.cashDeskMovement.create({
      data: {
        requestId: payment.requestId,
        payloadKey: payloadKey({ salesPaymentId: payment.id, accountId }),
        kind: 'SALE_RECEIPT',
        amount: payment.amount,
        currency: sale.currency,
        businessDate: payment.paymentDate,
        description: `Sale payment · ${sale.saleNumber}`,
        reference: payment.reference,
        createdBy: user.id,
        actorName: user.fullName || user.email,
        salesPaymentId: payment.id,
      },
    });
    await this.entries(tx, movement.id, payment.paymentDate, [{ account, amount: payment.amount }]);
    await this.auditMovement(tx, user, movement.id, [account], 'SALE_RECEIPT');
    return movement;
  }
}
