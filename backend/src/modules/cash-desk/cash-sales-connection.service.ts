import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { PrismaService } from '../../prisma/prisma.service';
import { CashQuery } from './cash-desk.dto';
import { todayUtc } from '../invoice-desk/invoice-desk.domain';

const names = {
  company: { select: { name: true } },
  division: { select: { name: true } },
  branch: { select: { name: true } },
} as const;
const open = ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as const;
const MAX_SOURCES = 10000;
type BusinessScope = {
  AND: [
    Awaited<ReturnType<CompanyScopeService['companyWhereFor']>>,
    Awaited<ReturnType<OrganizationScopeService['recordWhereFor']>>,
    { divisionId?: string; branchId?: string },
  ];
  deletedAt: null;
};

/** A live projection of the original Sales Desk books. Never creates a second cash entry. */
@Injectable()
export class CashSalesConnectionService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
  ) {}

  async read(user: AuthUser, q: CashQuery) {
    if (
      !['cash_desk.view', 'sales.view', 'receivables.view'].every((p) =>
        user.permissions.includes(p),
      )
    )
      throw new ForbiddenException('Cash Desk, sales and receivables access are required.');
    const scope: BusinessScope = {
      AND: [
        await this.companies.companyWhereFor(user, q.companyId),
        await this.org.recordWhereFor(user),
        { divisionId: q.divisionId, branchId: q.branchId },
      ],
      deletedAt: null,
    };
    return this.db.$transaction((tx) => this.snapshot(tx, user, q, scope), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
    });
  }

  private async snapshot(
    db: Prisma.TransactionClient,
    user: AuthUser,
    q: CashQuery,
    scope: BusinessScope,
  ) {
    const date = q.date ?? todayUtc();
    const period = { gte: dateRangeStart(date), lte: dateRangeEnd(date) };
    const accountsVisible = user.permissions.includes('cash_accounts.view');
    const receiptsVisible = user.permissions.includes('customer-payments.view');
    // Both source records and their receivables are scoped: a stray legacy sourceId must
    // never expose a different company's or branch's sales through this projection.
    const sales = await db.salesOrder.findMany({
      where: { ...scope, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      select: {
        id: true,
        salesOrderNumber: true,
        companyId: true,
        currency: true,
        receivableId: true,
        customerName: true,
        paymentMethod: true,
        cashAccountId: true,
        paidAmount: true,
        journalEntryId: true,
      },
      take: MAX_SOURCES + 1,
    });
    if (sales.length > MAX_SOURCES)
      throw new BadRequestException(
        'Choose a smaller company, division or branch to view collections.',
      );
    const saleIds = sales.map((s) => s.id);
    const receivableWhere: Prisma.ReceivableWhereInput = {
      ...scope,
      OR: [
        { id: { in: sales.flatMap((s) => (s.receivableId ? [s.receivableId] : [])) } },
        { sourceType: 'SalesOrder', sourceId: { in: saleIds } },
      ],
    };
    const receivables = await db.receivable.findMany({
      where: receivableWhere,
      select: {
        id: true,
        receivableNumber: true,
        companyId: true,
        divisionId: true,
        branchId: true,
        customerName: true,
        customerId: true,
        currency: true,
        amount: true,
        paidAmount: true,
        outstandingAmount: true,
        status: true,
        dueDate: true,
        sourceId: true,
        journalEntryId: true,
        ...names,
      },
      take: MAX_SOURCES + 1,
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    if (receivables.length > MAX_SOURCES)
      throw new BadRequestException(
        'Choose a smaller company, division or branch to view collections.',
      );
    // Party linkage (Phase 2): a customer's other open debt appears beside its receivables,
    // labelled by source. Unpromoted Sales Desk sales count towards what customers owe;
    // NoteBook debtors are informal and reported separately, never added to the total. Each
    // source is read only with its own permission and only for records linked to a canonical
    // customer, so a free-text NoteBook name never becomes a guessed identity.
    const deskVisible = user.permissions.includes('sales_desk.view');
    const notebookVisible = user.permissions.includes('records.view');
    const deskSales = deskVisible
      ? await db.salesDeskSale.findMany({
          where: {
            AND: scope.AND,
            voidedAt: null,
            canonicalSalesOrderId: null,
            customer: { canonicalCustomerId: { not: null } },
            paidAmount: { lt: db.salesDeskSale.fields.totalAmount },
          },
          select: {
            id: true,
            saleNumber: true,
            companyId: true,
            divisionId: true,
            branchId: true,
            currency: true,
            totalAmount: true,
            paidAmount: true,
            dueDate: true,
            customer: { select: { name: true, canonicalCustomerId: true } },
            branch: { select: { name: true } },
          },
          take: MAX_SOURCES + 1,
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        })
      : [];
    const notebook = notebookVisible
      ? await db.recordEntry.findMany({
          where: {
            AND: scope.AND,
            voidedAt: null,
            kind: 'DEBTOR',
            customerId: { not: null },
            settledAmount: { lt: db.recordEntry.fields.amount },
          },
          select: {
            id: true,
            title: true,
            counterparty: true,
            reference: true,
            companyId: true,
            divisionId: true,
            branchId: true,
            currency: true,
            amount: true,
            settledAmount: true,
            dueDate: true,
            customerId: true,
            customer: { select: { name: true } },
            branch: { select: { name: true } },
          },
          take: MAX_SOURCES + 1,
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        })
      : [];
    if (deskSales.length > MAX_SOURCES || notebook.length > MAX_SOURCES)
      throw new BadRequestException(
        'Choose a smaller company, division or branch to view collections.',
      );
    const accounts = accountsVisible
      ? await db.cashAccount.findMany({
          where: scope,
          select: {
            id: true,
            accountName: true,
            accountType: true,
            currency: true,
            currentBalance: true,
            isActive: true,
            ...names,
          },
          orderBy: [{ accountName: 'asc' }, { id: 'asc' }],
        })
      : [];
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const salesById = new Map(sales.map((s) => [s.id, s]));
    const salesByReceivable = new Map(
      sales.filter((s) => s.receivableId).map((s) => [s.receivableId, s]),
    );
    const saleFor = (r: (typeof receivables)[number]) =>
      salesByReceivable.get(r.id) ?? salesById.get(r.sourceId ?? '');
    const receivableById = new Map(receivables.map((r) => [r.id, r]));
    const receipts: Array<{
      id: string;
      date: Date;
      reference: string;
      customer: string;
      amount: string;
      currency: string;
      account: string | null;
      saleId: string | null;
      kind: string;
    }> = [];

    if (receiptsVisible) {
      const journals = await db.journalEntry.findMany({
        where: {
          ...scope,
          status: 'POSTED',
          reversalOfId: null,
          transactionDate: period,
          OR: [
            {
              referenceType: 'SalesOrder',
              id: {
                in: sales
                  .filter((s) => s.paymentMethod !== 'CREDIT' && s.paidAmount.gt(0))
                  .flatMap((s) => (s.journalEntryId ? [s.journalEntryId] : [])),
              },
            },
            {
              referenceType: 'Receivable',
              referenceId: { in: receivables.map((r) => r.id) },
              // Write-offs share this reference type but debit an expense, not cash.
              lines: { some: { debit: { gt: 0 }, account: { accountType: 'ASSET' } } },
              id: {
                notIn: receivables.flatMap((r) => (r.journalEntryId ? [r.journalEntryId] : [])),
              },
            },
          ],
        },
        select: {
          id: true,
          referenceType: true,
          referenceId: true,
          transactionDate: true,
          journalNumber: true,
          totalDebit: true,
        },
        take: MAX_SOURCES + 1,
      });
      const payments = await db.customerPayment.findMany({
        where: {
          ...scope,
          status: 'COMPLETED',
          journalEntry: { status: 'POSTED', deletedAt: null },
          paymentDate: period,
          allocations: { some: { receivableId: { in: receivables.map((r) => r.id) } } },
        },
        select: {
          id: true,
          paymentNumber: true,
          paymentDate: true,
          currency: true,
          cashAccountId: true,
          allocations: {
            where: { receivableId: { in: receivables.map((r) => r.id) } },
            select: { amount: true, receivableId: true },
          },
        },
        take: MAX_SOURCES + 1,
      });
      if (journals.length > MAX_SOURCES || payments.length > MAX_SOURCES)
        throw new BadRequestException(
          'Choose a smaller company, division or branch for this collection date.',
        );
      for (const j of journals) {
        const r = receivableById.get(j.referenceId ?? '');
        const s =
          j.referenceType === 'SalesOrder'
            ? salesById.get(j.referenceId ?? '')
            : r
              ? saleFor(r)
              : undefined;
        if (!s || (r && r.companyId !== s.companyId)) continue;
        receipts.push({
          id: j.id,
          date: j.transactionDate,
          reference: j.journalNumber,
          customer: r?.customerName ?? s.customerName ?? 'Customer',
          // The sales journal also includes COGS; its totalDebit is NOT the cash receipt.
          amount: (j.referenceType === 'SalesOrder' ? s.paidAmount : j.totalDebit).toFixed(2),
          currency: r?.currency ?? s.currency,
          saleId: s.id,
          account:
            j.referenceType === 'SalesOrder'
              ? (accountById.get(s.cashAccountId ?? '')?.accountName ?? null)
              : null,
          kind: j.referenceType === 'SalesOrder' ? 'Cash sale' : 'Receivable collection',
        });
      }
      for (const p of payments) {
        const r = receivableById.get(p.allocations[0]?.receivableId);
        const s = r ? saleFor(r) : undefined;
        receipts.push({
          id: p.id,
          date: p.paymentDate,
          reference: p.paymentNumber,
          customer: r?.customerName ?? 'Customer',
          // Only allocations to the visible sales, not advances or other invoices.
          amount: p.allocations
            .reduce((total, a) => total.plus(a.amount), new Prisma.Decimal(0))
            .toFixed(2),
          currency: p.currency,
          account: accountById.get(p.cashAccountId ?? '')?.accountName ?? null,
          saleId: p.allocations.length === 1 ? (s?.id ?? null) : null,
          kind: 'Customer payment',
        });
      }
    }
    receipts.sort((a, b) => b.date.getTime() - a.date.getTime() || a.id.localeCompare(b.id));
    const openReceivables = receivables.filter(
      (r) => (open as readonly string[]).includes(r.status) && r.outstandingAmount.gt(0),
    );
    // One list, labelled by source. Receivable rows keep their full shape (and the collect
    // action); Sales Desk and NoteBook rows carry the same display fields and their own link.
    const none = null as string | null;
    const outstanding = [
      ...openReceivables.map((r) => ({
        ...r,
        source: 'RECEIVABLE' as const,
        customerId: r.customerId ?? none,
        saleId: saleFor(r)?.id ?? none,
        salesOrderNumber: saleFor(r)?.salesOrderNumber ?? none,
        deskSaleId: none,
        recordId: none,
        saleNumber: none,
      })),
      ...deskSales.map((s) => ({
        id: s.id,
        source: 'SALES_DESK' as const,
        companyId: s.companyId,
        divisionId: s.divisionId,
        branchId: s.branchId,
        customerId: s.customer.canonicalCustomerId,
        customerName: s.customer.name,
        receivableNumber: none,
        salesOrderNumber: none,
        saleId: none,
        deskSaleId: s.id,
        recordId: none,
        saleNumber: s.saleNumber,
        currency: s.currency,
        amount: s.totalAmount,
        paidAmount: s.paidAmount,
        outstandingAmount: s.totalAmount.minus(s.paidAmount),
        status: 'OPEN',
        dueDate: s.dueDate as Date | null,
        branch: s.branch,
      })),
      ...notebook.map((n) => ({
        id: n.id,
        source: 'NOTEBOOK' as const,
        companyId: n.companyId,
        divisionId: n.divisionId,
        branchId: n.branchId,
        customerId: n.customerId,
        customerName: n.customer?.name ?? n.counterparty ?? n.title,
        receivableNumber: n.reference,
        salesOrderNumber: none,
        saleId: none,
        deskSaleId: none,
        recordId: n.id,
        saleNumber: none,
        currency: n.currency,
        amount: n.amount,
        paidAmount: n.settledAmount,
        outstandingAmount: n.amount.minus(n.settledAmount),
        status: 'NOTEBOOK',
        dueDate: n.dueDate,
        branch: n.branch,
      })),
    ].sort(
      (a, b) =>
        (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
    const currencies = [
      ...new Set([
        ...accounts.map((a) => a.currency),
        ...outstanding.map((r) => r.currency),
        ...receipts.map((r) => r.currency),
      ]),
    ]
      .sort()
      .map((currency) => ({
        currency,
        balance: accountsVisible
          ? accounts
              .filter((a) => a.currency === currency)
              .reduce((n, a) => n.plus(a.currentBalance), new Prisma.Decimal(0))
              .toFixed(2)
          : null,
        outstanding: outstanding
          .filter((r) => r.currency === currency && r.source !== 'NOTEBOOK')
          .reduce((n, r) => n.plus(r.outstandingAmount), new Prisma.Decimal(0))
          .toFixed(2),
        notebook: notebookVisible
          ? outstanding
              .filter((r) => r.currency === currency && r.source === 'NOTEBOOK')
              .reduce((n, r) => n.plus(r.outstandingAmount), new Prisma.Decimal(0))
              .toFixed(2)
          : null,
        received: receiptsVisible
          ? receipts
              .filter((r) => r.currency === currency)
              .reduce((n, r) => n.plus(r.amount), new Prisma.Decimal(0))
              .toFixed(2)
          : null,
      }));
    const search = q.search?.trim().toLowerCase();
    const filtered = outstanding.filter(
      (r) =>
        !search ||
        [r.customerName, r.receivableNumber, r.salesOrderNumber, r.saleNumber].some((v) =>
          v?.toLowerCase().includes(search),
        ),
    );
    const pageSize = 25;
    const offset = (q.page - 1) * pageSize;
    return {
      date,
      currencies,
      accounts,
      accountsVisible,
      receiptsVisible,
      outstanding: { rows: filtered.slice(offset, offset + pageSize), total: filtered.length },
      receipts: { rows: receipts.slice(offset, offset + pageSize), total: receipts.length },
      page: q.page,
      pageSize,
    };
  }
}
