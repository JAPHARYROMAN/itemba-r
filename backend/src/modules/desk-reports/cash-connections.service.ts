import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DeskReportQuery } from './desk-reports.dto';
import { reportPeriod } from './desk-reports.domain';
import { cashFingerprint, cashLines, cashOffsetTypes } from './cash-posting.domain';
import { DeskPostingSource, postingStatus } from './desk-posting.domain';

const include = {
  payrollJournalEntry: { include: { lines: true } },
  loanFinancialEvent: { include: { journalEntry: true } },
  entries: {
    orderBy: { accountId: 'asc' as const },
    include: { account: { include: { erpCashAccount: { include: { ledgerAccount: true } } } } },
  },
  salesPayment: { include: { sale: true } },
  invoicePayment: { include: { invoice: true } },
} satisfies Prisma.CashDeskMovementInclude;
type Movement = Prisma.CashDeskMovementGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;
const compatible = (
  a: { companyId: string; divisionId: string | null; branchId: string | null },
  b: { companyId: string; divisionId: string | null; branchId: string | null },
) =>
  a.companyId === b.companyId &&
  (!a.divisionId || a.divisionId === b.divisionId) &&
  (!a.branchId || a.branchId === b.branchId);

@Injectable()
export class CashConnectionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly engine: PostingEngineService,
    private readonly audit: AuditLogsService,
  ) {}
  private permission(user: AuthUser, ...permissions: string[]) {
    if (!permissions.every((p) => user.permissions.includes(p)))
      throw new ForbiddenException(
        'Your role does not have permission for this financial connection.',
      );
  }
  private async scope(user: AuthUser, q: DeskReportQuery = {}) {
    return {
      AND: [
        await this.companies.companyWhereFor(user, q.companyId),
        await this.org.recordWhereFor(user),
        { divisionId: q.divisionId, branchId: q.branchId, currency: q.currency },
      ],
    };
  }
  private async writeScope(
    user: AuthUser,
    a: { companyId: string; divisionId: string | null; branchId: string | null },
  ) {
    await this.companies.assertCanAccessCompany(user, a.companyId, AccessLevel.WRITE);
    await this.org.assertCanAccessScope(user, a.divisionId, a.branchId, AccessLevel.WRITE);
  }
  async connections(user: AuthUser, q: DeskReportQuery) {
    this.permission(user, 'cash_desk.view', 'journal_entries.view');
    const scope = await this.scope(user, q);
    const [desk, bank, ledger] = await Promise.all([
      this.db.cashDeskAccount.findMany({
        where: scope,
        include: { company: { select: { name: true } }, branch: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.db.cashAccount.findMany({
        where: {
          AND: [
            await this.companies.companyWhereFor(user, q.companyId),
            await this.org.recordWhereFor(user),
          ],
          deletedAt: null,
          isActive: true,
        },
        include: { ledgerAccount: true },
        orderBy: { accountName: 'asc' },
      }),
      this.db.chartOfAccount.findMany({
        where: {
          AND: [
            await this.companies.companyWhereFor(user, q.companyId),
            await this.org.recordWhereFor(user),
          ],
          accountType: 'ASSET',
          isActive: true,
          deletedAt: null,
        },
        orderBy: { accountCode: 'asc' },
      }),
    ]);
    const balances = await this.db.journalEntryLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: {
          in: [
            ...new Set([
              ...ledger.map((l) => l.id),
              ...bank.flatMap((b) => (b.ledgerAccountId ? [b.ledgerAccountId] : [])),
            ]),
          ],
        },
        journalEntry: { status: { in: ['POSTED', 'REVERSED'] }, deletedAt: null },
      },
      _sum: { debit: true, credit: true },
    });
    const totals = new Map(
      balances.map((b) => [
        b.accountId,
        (b._sum.debit ?? new Prisma.Decimal(0)).minus(b._sum.credit ?? 0).toFixed(2),
      ]),
    );
    const writeAccess = new Map<string, Promise<boolean>>();
    const canConnect = (account: {
      companyId: string;
      divisionId: string | null;
      branchId: string | null;
    }) => {
      const key = JSON.stringify([account.companyId, account.divisionId, account.branchId]);
      if (!writeAccess.has(key))
        writeAccess.set(
          key,
          (async () => {
            if (
              !['cash_desk.manage', 'cash_accounts.manage'].every((p) =>
                user.permissions.includes(p),
              )
            )
              return false;
            try {
              await this.writeScope(user, account);
              return true;
            } catch (error) {
              if (error instanceof ForbiddenException) return false;
              throw error;
            }
          })(),
        );
      return writeAccess.get(key)!;
    };
    const [deskWithAccess, bankWithAccess] = await Promise.all([
      Promise.all(desk.map(async (d) => ({ ...d, canConnect: await canConnect(d) }))),
      Promise.all(
        bank.map(async (b) => {
          const ledgerBalance = b.ledgerAccountId
            ? (totals.get(b.ledgerAccountId) ?? '0.00')
            : null;
          return {
            ...b,
            canConnect: await canConnect(b),
            recordedBalance: b.currentBalance.toFixed(2),
            ledgerBalance,
            balanceDifference:
              ledgerBalance === null ? null : b.currentBalance.minus(ledgerBalance).toFixed(2),
          };
        }),
      ),
    ]);
    return {
      desk: deskWithAccess,
      bank: bankWithAccess,
      ledger: ledger.map((l) => ({ ...l, ledgerBalance: totals.get(l.id) ?? '0.00' })),
    };
  }
  async unlinkedPayments(user: AuthUser, q: DeskReportQuery) {
    this.permission(user, 'cash_desk.view', 'invoice_desk.view', 'journal_entries.view');
    const period = reportPeriod(q);
    const payments = await this.db.invoiceDeskPayment.findMany({
      where: {
        reversedAt: null,
        cashMovement: null,
        paymentDate: { gte: new Date(period.from), lte: new Date(period.to) },
        invoice: await this.scope(user, q),
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            companyId: true,
            divisionId: true,
            branchId: true,
            currency: true,
            supplier: { select: { name: true } },
          },
        },
      },
      orderBy: { paymentDate: 'desc' },
      take: 1001,
    });
    if (payments.length > 1000)
      throw new BadRequestException('Narrow the period to at most 1,000 unlinked payments.');
    return payments;
  }
  async connect(
    user: AuthUser,
    input: { deskAccountId?: string; cashAccountId: string; ledgerAccountId: string },
  ) {
    this.permission(
      user,
      'cash_desk.view',
      'cash_desk.manage',
      'cash_accounts.manage',
      'journal_entries.view',
    );
    return this.db.$transaction(
      async (tx) => {
        // A mapping becomes part of the account identity; it cannot silently reclassify history.
        if (input.deskAccountId)
          await tx.$queryRaw`SELECT id FROM cash_desk_accounts WHERE id = ${input.deskAccountId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${input.cashAccountId} FOR UPDATE`;
        const bank = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
        const ledger = await tx.chartOfAccount.findUnique({ where: { id: input.ledgerAccountId } });
        const desk = input.deskAccountId
          ? await tx.cashDeskAccount.findUnique({ where: { id: input.deskAccountId } })
          : null;
        if (!bank || !ledger || (input.deskAccountId && !desk))
          throw new NotFoundException('Account not found.');
        await this.writeScope(user, bank);
        if (desk) await this.writeScope(user, desk);
        if (
          !bank.isActive ||
          bank.deletedAt ||
          !ledger.isActive ||
          ledger.deletedAt ||
          ledger.accountType !== 'ASSET' ||
          !compatible(ledger, bank)
        )
          throw new BadRequestException(
            'Choose an active asset ledger account in the same company and organisation.',
          );
        const profile = await tx.companyProfile.findUnique({
          where: { companyId: bank.companyId },
        });
        if (
          !profile ||
          bank.currency !== profile.currency ||
          (desk &&
            (desk.currency !== bank.currency ||
              !compatible(bank, desk) ||
              !compatible(ledger, desk)))
        )
          throw new BadRequestException(
            'Account organisation and currencies must match the company accounting currency.',
          );
        if (
          (bank.ledgerAccountId && bank.ledgerAccountId !== ledger.id) ||
          (desk?.erpCashAccountId && desk.erpCashAccountId !== bank.id)
        )
          throw new ConflictException(
            'This account is already connected. Historical connections cannot be reassigned here.',
          );
        const otherBank = await tx.cashAccount.findUnique({
          where: { ledgerAccountId: ledger.id },
        });
        const otherDesk = desk
          ? await tx.cashDeskAccount.findUnique({ where: { erpCashAccountId: bank.id } })
          : null;
        if ((otherBank && otherBank.id !== bank.id) || (otherDesk && otherDesk.id !== desk?.id))
          throw new ConflictException(
            'Each cash account needs its own ledger account and Cash Desk connection.',
          );
        await tx.cashAccount.update({
          where: { id: bank.id },
          data: { ledgerAccountId: ledger.id },
        });
        if (desk)
          await tx.cashDeskAccount.update({
            where: { id: desk.id },
            data: { erpCashAccountId: bank.id },
          });
        await this.audit.logStrictInTransaction(tx, {
          action: 'CONNECT',
          entityType: 'CashLedgerConnection',
          entityId: bank.id,
          companyId: bank.companyId,
          userId: user.id,
          metadata: input,
        });
        return { connected: true };
      },
      { timeout: 30000 },
    );
  }
  private async source(tx: Tx, user: AuthUser, id: string) {
    this.permission(user, 'cash_desk.view', 'journal_entries.view');
    const row = await tx.cashDeskMovement.findFirst({
      where: { id, entries: { some: { account: await this.scope(user) } } },
      include,
    });
    if (!row) throw new NotFoundException('Cash movement not found.');
    // Every side must be accessible; a transfer must not expose another branch through its first side.
    const allowed = await tx.cashDeskAccount.count({
      where: { AND: [await this.scope(user), { id: { in: row.entries.map((e) => e.accountId) } }] },
    });
    if (allowed !== row.entries.length)
      throw new ForbiddenException('Access to every account in this movement is required.');
    return row;
  }
  private snapshot(row: Movement) {
    return {
      id: row.id,
      kind: row.kind,
      amount: row.amount.toFixed(2),
      currency: row.currency,
      date: row.businessDate.toISOString().slice(0, 10),
      description: row.description,
      reference: row.reference,
      reversed: !!row.reversedAt,
      reversalOfId: row.reversalOfId,
      invoicePaymentId: row.invoicePaymentId,
      salesPaymentId: row.salesPaymentId,
      entries: row.entries.map((e) => ({
        accountId: e.accountId,
        name: e.account.name,
        companyId: e.account.companyId,
        divisionId: e.account.divisionId,
        branchId: e.account.branchId,
        amount: e.amount.toFixed(2),
        bankId: e.account.erpCashAccountId,
        ledgerId: e.account.erpCashAccount?.ledgerAccountId,
      })),
    };
  }
  private journals(tx: Tx, id: string) {
    return tx.journalEntry.findMany({
      where: {
        OR: [
          { referenceType: { in: ['DeskCash', 'DeskIntercompany'] }, referenceId: id },
          { loanFinancialEvent: { cashMovementId: id } },
          { payrollCashMovement: { id } },
        ],
      },
      include: { lines: true },
    });
  }
  async list(user: AuthUser, q: DeskReportQuery) {
    this.permission(user, 'cash_desk.view', 'journal_entries.view');
    const scope = await this.scope(user, q),
      period = reportPeriod(q);
    const rows = await this.db.cashDeskMovement.findMany({
      where: {
        businessDate: { gte: new Date(period.from), lte: new Date(period.to) },
        entries: { some: { account: scope }, every: { account: scope } },
      },
      include,
      orderBy: [{ businessDate: 'desc' }, { id: 'asc' }],
      take: 1001,
    });
    if (rows.length > 1000)
      throw new BadRequestException(
        'Narrow the period or organisation to at most 1,000 movements.',
      );
    const journals = await this.db.journalEntry.findMany({
      where: {
        referenceType: { in: ['DeskCash', 'DeskIntercompany'] },
        referenceId: { in: rows.map((r) => r.id) },
      },
      include: { lines: true },
    });
    return rows.map((row) => {
      const linked = journals.filter((j) => j.referenceId === row.id),
        source = this.snapshot(row);
      const journal = linked[0];
      let status = 'Unposted';
      const lifecycle = row.loanFinancialEvent;
      if (row.payrollRunId) {
        const j = row.payrollJournalEntry;
        status =
          j &&
          !j.deletedAt &&
          j.referenceType === 'PayrollRunPayment' &&
          j.referenceId === row.payrollRunId &&
          j.status === (row.reversedAt ? 'REVERSED' : 'POSTED') &&
          j.totalDebit.eq(row.amount) &&
          j.totalCredit.eq(row.amount) &&
          j.transactionDate.toISOString().slice(0, 10) === source.date &&
          row.entries.every((e) =>
            j.lines
              .filter((l) => l.accountId === e.account.erpCashAccount?.ledgerAccountId)
              .reduce((n, l) => n.plus(l.debit).minus(l.credit), new Prisma.Decimal(0))
              .eq(e.amount),
          )
            ? row.reversedAt
              ? 'Reversed'
              : 'Posted'
            : 'Needs review';
      } else if (lifecycle) {
        const j = lifecycle.journalEntry;
        status =
          !j.deletedAt &&
          j.referenceType === 'LoanLifecycle' &&
          j.referenceId === lifecycle.id &&
          j.transactionDate.toISOString().slice(0, 10) === source.date &&
          lifecycle.amount.eq(row.amount)
            ? row.reversedAt
              ? j.status === 'REVERSED'
                ? 'Reversed'
                : 'Needs review'
              : j.status === 'POSTED'
                ? 'Posted'
                : 'Needs review'
            : 'Needs review';
      } else if (linked.some((j) => j.referenceType === 'DeskIntercompany')) {
        const expected = row.reversedAt ? 'REVERSED' : 'POSTED';
        status =
          linked.length === 2 &&
          new Set(linked.map((j) => j.companyId)).size === 2 &&
          linked.every(
            (j) =>
              !j.deletedAt &&
              j.status === expected &&
              j.totalDebit.eq(j.totalCredit) &&
              j.transactionDate.toISOString().slice(0, 10) === source.date &&
              row.entries.some(
                (e) =>
                  e.account.companyId === j.companyId &&
                  j.lines
                    .filter((l) => l.accountId === e.account.erpCashAccount?.ledgerAccountId)
                    .reduce((n, l) => n.plus(l.debit).minus(l.credit), new Prisma.Decimal(0))
                    .eq(e.amount),
              ),
          )
            ? row.reversedAt
              ? 'Reversed'
              : 'Posted'
            : 'Needs review';
      } else if (linked.length > 1) status = 'Needs review';
      else if (journal) {
        if (journal.deletedAt) status = 'Needs review';
        else if (row.reversedAt)
          status = journal.status === 'REVERSED' ? 'Reversed' : 'Needs review';
        else if (journal.status !== 'POSTED') status = 'Needs review';
        else if (
          !journal.totalDebit.eq(row.amount) ||
          !journal.totalCredit.eq(row.amount) ||
          journal.transactionDate.toISOString().slice(0, 10) !== source.date ||
          (!row.reversalOfId &&
            !journal.description?.includes(`[cash-record:${cashFingerprint(source)}]`))
        )
          status = 'Needs review';
        else status = 'Posted';
      } else if (row.reversedAt || row.reversalOfId) status = 'Cancelled';
      else if (row.loanId) status = 'Loan connection pending';
      else if (row.entries.some((e) => !e.account.erpCashAccount?.ledgerAccountId))
        status = 'Account connection needed';
      return { ...source, status };
    });
  }
  private async prepare(tx: Tx, user: AuthUser, row: Movement) {
    const source = this.snapshot(row),
      journals = await this.journals(tx, row.id),
      issues: string[] = [];
    const first = row.entries[0]?.account;
    if (!first) throw new BadRequestException('Movement has no cash entries.');
    if (
      row.payrollRunId ||
      row.loanFinancialEvent ||
      row.loanId ||
      journals.some((j) => j.referenceType === 'DeskIntercompany')
    )
      return {
        source,
        fingerprint: cashFingerprint(source),
        journals: journals.map((j) => ({ id: j.id, number: j.journalNumber, status: j.status })),
        issues: journals.length
          ? [
              row.payrollRunId
                ? 'This payment is managed in Payroll. Reverse or correct it there.'
                : 'This movement is managed with its loan. Use the loan history or Cash Desk to reverse it.',
            ]
          : [
              'This historical loan movement has no connected journal. Review its original accounting evidence before continuing.',
            ],
        offsetId: null,
        accounts: [],
        cashAccounts: row.entries.map((e) => ({
          id: e.account.erpCashAccount?.ledgerAccountId,
          name: e.account.name,
          amount: e.amount.toFixed(2),
        })),
      };
    if (row.reversedAt || row.reversalOfId)
      issues.push(
        'This movement is cancelled or is a reversal. Posted reversals are handled together in Cash Desk.',
      );
    if (
      row.loanId ||
      ![...Object.keys(cashOffsetTypes), 'TRANSFER', 'SALE_RECEIPT', 'SUPPLIER_PAYMENT'].includes(
        row.kind,
      )
    )
      issues.push('Loan and intercompany posting needs the next financial connection.');
    const profile = await tx.companyProfile.findUnique({ where: { companyId: first.companyId } });
    if (!profile || profile.currency !== row.currency)
      issues.push('Movement currency must match the company accounting currency.');
    for (const entry of row.entries) {
      const a = entry.account,
        bank = a.erpCashAccount,
        gl = bank?.ledgerAccount;
      if (a.companyId !== first.companyId)
        issues.push(
          'Intercompany movements need paired company journals and are not available here yet.',
        );
      if (
        !bank ||
        !gl ||
        !bank.isActive ||
        bank.deletedAt ||
        !gl.isActive ||
        gl.deletedAt ||
        gl.accountType !== 'ASSET' ||
        bank.currency !== row.currency ||
        a.currency !== row.currency ||
        !compatible(bank, a) ||
        !compatible(gl, a)
      )
        issues.push(
          `Connect ${a.name} to an active cash account and dedicated asset ledger account in the same organisation and currency.`,
        );
    }
    let offsetId: string | undefined,
      parentJournal: { id: string; description: string | null; status: string } | undefined;
    if (row.kind === 'SALE_RECEIPT' || row.kind === 'SUPPLIER_PAYMENT') {
      const sale = row.kind === 'SALE_RECEIPT';
      this.permission(user, sale ? 'sales_desk.view' : 'invoice_desk.view');
      const payment = sale ? row.salesPayment : row.invoicePayment;
      const invoice = sale ? row.salesPayment?.sale : row.invoicePayment?.invoice;
      if (
        !payment ||
        !invoice ||
        payment.reversedAt ||
        !payment.amount.eq(row.amount) ||
        invoice.companyId !== first.companyId ||
        invoice.currency !== row.currency
      )
        issues.push('The linked invoice payment is missing, reversed or inconsistent.');
      else {
        await this.companies.assertCanAccessCompany(user, invoice.companyId);
        await this.org.assertCanAccessScope(user, invoice.divisionId, invoice.branchId);
        const isSale = 'saleDate' in invoice;
        const doc: DeskPostingSource = {
          id: invoice.id,
          kind: isSale ? 'sales' : 'purchases',
          companyId: invoice.companyId,
          divisionId: invoice.divisionId,
          branchId: invoice.branchId,
          reference: isSale ? invoice.saleNumber : invoice.invoiceNumber,
          currency: invoice.currency,
          date: (isSale ? invoice.saleDate : invoice.invoiceDate).toISOString().slice(0, 10),
          amount: invoice.totalAmount.toFixed(2),
          partyId: isSale ? invoice.customerId : invoice.supplierId,
          voided: !!invoice.voidedAt,
        };
        const parents = await tx.journalEntry.findMany({
          where: {
            referenceType: sale ? 'DeskSale' : 'DeskPurchase',
            referenceId: invoice.id,
            companyId: first.companyId,
            deletedAt: null,
          },
          include: { lines: { include: { account: true } } },
        });
        if (postingStatus(doc, parents) !== 'Posted')
          issues.push(
            'Post and verify the linked invoice first. Payment posting settles that invoice’s receivable or payable.',
          );
        else {
          const parent = parents.find((p) => !p.reversalOfId)!;
          const candidates = parent.lines.filter((l) =>
            sale
              ? l.debit.gt(0) && l.account.accountType === 'ASSET'
              : l.credit.gt(0) && l.account.accountType === 'LIABILITY',
          );
          if (candidates.length !== 1)
            issues.push('The invoice does not have a single receivable or payable account.');
          else offsetId = candidates[0].accountId;
          parentJournal = { id: parent.id, description: parent.description, status: parent.status };
        }
      }
    }
    const accounts = await tx.chartOfAccount.findMany({
      where: { companyId: first.companyId, isActive: true, deletedAt: null },
      orderBy: { accountCode: 'asc' },
    });
    const eligible = accounts.filter(
      (a) =>
        row.entries.every((e) => compatible(a, e.account)) &&
        !row.entries.some((e) => e.account.erpCashAccount?.ledgerAccountId === a.id) &&
        (offsetId ? a.id === offsetId : (cashOffsetTypes[row.kind] ?? []).includes(a.accountType)),
    );
    if (offsetId && !eligible.some((a) => a.id === offsetId))
      issues.push(
        'The invoice control account is inactive or belongs to a different organisation.',
      );
    return {
      source,
      fingerprint: cashFingerprint({ source, parentJournal }),
      journals: journals.map((j) => ({ id: j.id, number: j.journalNumber, status: j.status })),
      issues: [...new Set(issues)],
      offsetId: offsetId ?? null,
      accounts: eligible.map((a) => ({
        id: a.id,
        accountCode: a.accountCode,
        accountName: a.accountName,
        accountType: a.accountType,
      })),
      cashAccounts: row.entries.map((e) => ({
        id: e.account.erpCashAccount?.ledgerAccountId,
        name: e.account.erpCashAccount?.ledgerAccount?.accountName,
        amount: e.amount.toFixed(2),
      })),
    };
  }
  async review(user: AuthUser, id: string) {
    return this.db.$transaction(
      async (tx) => this.prepare(tx, user, await this.source(tx, user, id)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
  async post(user: AuthUser, id: string, input: { fingerprint: string; offsetAccountId?: string }) {
    this.permission(
      user,
      'cash_desk.view',
      'journal_entries.view',
      'journal_entries.create',
      'journal_entries.post',
    );
    return this.db.$transaction(
      async (tx) => {
        const initial = await this.source(tx, user, id);
        // Match operational lock ordering: sale, cash accounts, movement, invoice.
        if (initial.salesPayment)
          await tx.$queryRaw`SELECT id FROM sales_desk_sales WHERE id = ${initial.salesPayment.saleId} FOR UPDATE`;
        for (const e of initial.entries)
          await tx.$queryRaw`SELECT id FROM cash_desk_accounts WHERE id = ${e.accountId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM cash_desk_movements WHERE id = ${id} FOR UPDATE`;
        if (initial.invoicePayment)
          await tx.$queryRaw`SELECT id FROM invoice_desk_invoices WHERE id = ${initial.invoicePayment.invoiceId} FOR UPDATE`;
        const row = await this.source(tx, user, id);
        for (const e of row.entries) await this.writeScope(user, e.account);
        const review = await this.prepare(tx, user, row);
        if (review.journals.length)
          throw new ConflictException(
            'This movement already has a journal. It cannot be posted twice.',
          );
        if (review.fingerprint !== input.fingerprint)
          throw new ConflictException('The movement or its connection changed. Review it again.');
        if (review.issues.length) throw new BadRequestException(review.issues.join(' '));
        const offsetId = review.offsetId ?? input.offsetAccountId;
        if (row.kind !== 'TRANSFER' && !review.accounts.some((a) => a.id === offsetId))
          throw new BadRequestException('Choose a valid offset account.');
        const lines = cashLines(
          row.kind,
          row.amount,
          row.entries.map((e) => ({
            accountId: e.account.erpCashAccount!.ledgerAccountId!,
            amount: e.amount,
          })),
          offsetId,
        );
        const first = row.entries[0].account;
        const result = await this.engine.postLines(
          {
            companyId: first.companyId,
            divisionId: row.entries.every((e) => e.account.divisionId === first.divisionId)
              ? first.divisionId
              : null,
            branchId: row.entries.every((e) => e.account.branchId === first.branchId)
              ? first.branchId
              : null,
            transactionDate: row.businessDate,
            description: `Cash Desk · ${row.description} [cash-record:${cashFingerprint(review.source)}] [desk-cash:${input.fingerprint}]`,
            referenceType: 'DeskCash',
            referenceId: id,
            journalNumber: `JE-CASH-${randomUUID()}`,
            userId: user.id,
            moduleName: 'CashDesk',
            lines,
          },
          tx,
        );
        // Keep the organisation on each cash leg, including cross-branch transfers.
        for (const e of row.entries)
          await tx.journalEntryLine.updateMany({
            where: {
              journalEntryId: result.id,
              accountId: e.account.erpCashAccount!.ledgerAccountId!,
            },
            data: { divisionId: e.account.divisionId, branchId: e.account.branchId },
          });
        await this.audit.logStrictInTransaction(tx, {
          action: 'POST',
          entityType: 'DeskCash',
          entityId: id,
          companyId: first.companyId,
          userId: user.id,
          metadata: { ...input, journalEntryId: result.id },
        });
        return result;
      },
      { timeout: 30000 },
    );
  }
  async reverseInTransaction(
    tx: Tx,
    user: AuthUser,
    movementId: string,
    reversalId: string,
    date: Date,
    reason: string,
  ) {
    const journals = await tx.journalEntry.findMany({
      where: { referenceType: 'DeskCash', referenceId: movementId },
      include: { lines: true },
    });
    if (!journals.length) return;
    this.permission(user, 'journal_entries.reverse');
    const original = journals[0];
    if (
      journals.length !== 1 ||
      original.status !== 'POSTED' ||
      original.deletedAt ||
      original.reversalOfId
    )
      throw new ConflictException(
        'The linked cash journal needs review before reversing this movement.',
      );
    const claim = await tx.journalEntry.updateMany({
      where: { id: original.id, status: 'POSTED', reversedAt: null },
      data: {
        status: 'REVERSED',
        reversedAt: new Date(),
        reversedById: user.id,
        reversalReason: reason,
      },
    });
    if (claim.count !== 1)
      throw new ConflictException('The cash journal changed. Refresh and try again.');
    const result = await this.engine.postLines(
      {
        companyId: original.companyId,
        divisionId: original.divisionId,
        branchId: original.branchId,
        transactionDate: date,
        description: `Cash Desk reversal · ${reason}`,
        referenceType: 'DeskCash',
        referenceId: reversalId,
        journalNumber: `JE-CASH-${randomUUID()}`,
        userId: user.id,
        moduleName: 'CashDesk',
        lines: original.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
        })),
      },
      tx,
    );
    await tx.journalEntry.update({ where: { id: result.id }, data: { reversalOfId: original.id } });
    for (const l of original.lines)
      await tx.journalEntryLine.updateMany({
        where: { journalEntryId: result.id, accountId: l.accountId },
        data: { divisionId: l.divisionId, branchId: l.branchId },
      });
    await this.audit.logStrictInTransaction(tx, {
      action: 'REVERSE',
      entityType: 'DeskCash',
      entityId: movementId,
      companyId: original.companyId,
      userId: user.id,
      metadata: { reversalId, journalEntryId: result.id, reason },
    });
  }
}
