import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { CurrencyCode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import type { BusinessReportQuery } from './business-reports.controller';

export const businessPermissions = {
  sales: 'sales.view',
  customers: 'receivables.view',
  suppliers: 'payables.view',
  expenses: 'expenses.view',
  accounts: 'cash_accounts.view',
} as const;
type Row = {
  id: string;
  reference: string;
  party: string;
  date: Date | null;
  currency: string;
  amount: Prisma.Decimal;
  paid: Prisma.Decimal;
  balance: Prisma.Decimal;
  status: string;
  href: string;
};
const zero = () => new Prisma.Decimal(0);

@Injectable()
export class BusinessReportsService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
  ) {}
  async directory(user: AuthUser) {
    if (!Object.values(businessPermissions).some((p) => user.permissions.includes(p)))
      throw new ForbiddenException('Business report access is required.');
    const companies = await this.db.company.findMany({
      where: {
        ...(this.companies.isGroupScoped(user)
          ? {}
          : { id: { in: await this.companies.accessibleCompanyIds(user) } }),
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: { id: true, name: true },
    });
    const scope = await this.org.accessibleIds(user);
    const branches = await this.db.branch.findMany({
      where: {
        division: { companyId: { in: companies.map((c) => c.id) }, deletedAt: null },
        deletedAt: null,
        ...(scope.unrestricted
          ? {}
          : { OR: [{ id: { in: scope.branchIds } }, { divisionId: { in: scope.divisionIds } }] }),
      },
      select: {
        id: true,
        name: true,
        divisionId: true,
        division: { select: { id: true, name: true, companyId: true } },
      },
    });
    return {
      companies,
      divisions: [...new Map(branches.map((b) => [b.division.id, b.division])).values()],
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        divisionId: b.divisionId,
        companyId: b.division.companyId,
      })),
    };
  }
  async read(user: AuthUser, q: BusinessReportQuery) {
    if (!user.permissions.includes(businessPermissions[q.kind]))
      throw new ForbiddenException('Your role cannot read this business report.');
    if (q.from && q.to && q.from > q.to)
      throw new BadRequestException('Start date must precede end date.');
    for (const d of [q.from, q.to].filter(Boolean) as string[])
      if (!Number.isFinite(new Date(d).getTime()) || new Date(d).toISOString().slice(0, 10) !== d)
        throw new BadRequestException('Choose valid report dates.');
    const scope = {
      AND: [
        await this.companies.companyWhereFor(user, q.companyId),
        await this.org.recordWhereFor(user),
        { divisionId: q.divisionId, branchId: q.branchId },
      ],
      deletedAt: null,
      currency: q.currency as CurrencyCode | undefined,
    };
    const date = {
      ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
      ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
    };
    // Bounded complete snapshots: never silently total a truncated page.
    return this.db.$transaction(
      async (tx) => {
        let rows: Row[];
        const take = 20001;
        if (q.kind === 'sales')
          rows = (
            await tx.salesOrder.findMany({
              where: { ...scope, orderDate: date, status: { notIn: ['DRAFT', 'CANCELLED'] } },
              take,
              orderBy: [{ orderDate: 'desc' }, { id: 'asc' }],
            })
          ).map((r) => ({
            id: r.id,
            reference: r.salesOrderNumber,
            party: r.customerName ?? '',
            date: r.orderDate,
            currency: r.currency,
            amount: r.totalAmount,
            paid: r.paidAmount,
            balance: r.outstandingAmount,
            status: r.status,
            href: `/sales-desk/sales/${encodeURIComponent(r.id)}`,
          }));
        else if (q.kind === 'customers')
          rows = (
            await tx.receivable.findMany({
              where: { ...scope, issueDate: date },
              take,
              orderBy: [{ issueDate: 'desc' }, { id: 'asc' }],
            })
          ).map((r) => ({
            id: r.id,
            reference: r.receivableNumber,
            party: r.customerName,
            date: r.issueDate,
            currency: r.currency,
            amount: r.amount,
            paid: r.paidAmount,
            balance: r.outstandingAmount,
            status: r.status,
            href: '/cash-desk/receivables',
          }));
        else if (q.kind === 'suppliers')
          rows = (
            await tx.payable.findMany({
              where: { ...scope, issueDate: date, status: { not: 'CANCELLED' } },
              take,
              orderBy: [{ issueDate: 'desc' }, { id: 'asc' }],
            })
          ).map((r) => ({
            id: r.id,
            reference: r.payableNumber,
            party: r.supplierName,
            date: r.issueDate,
            currency: r.currency,
            amount: r.amount,
            paid: r.paidAmount,
            balance: r.outstandingAmount,
            status: r.status,
            href: '/cash-desk/payables',
          }));
        else if (q.kind === 'expenses')
          rows = (
            await tx.expense.findMany({
              where: { ...scope, expenseDate: date, status: { in: ['APPROVED', 'PAID'] } },
              take,
              orderBy: [{ expenseDate: 'desc' }, { id: 'asc' }],
            })
          ).map((r) => ({
            id: r.id,
            reference: r.expenseNumber,
            party: r.vendorName ?? r.description,
            date: r.expenseDate,
            currency: r.currency,
            amount: r.amount,
            paid: r.status === 'PAID' ? r.amount : zero(),
            balance: r.status === 'PAID' ? zero() : r.amount,
            status: r.status,
            href: '/cash-desk/expenses',
          }));
        else
          rows = (
            await tx.cashAccount.findMany({
              where: { ...scope, isActive: true },
              take,
              orderBy: [{ accountName: 'asc' }, { id: 'asc' }],
            })
          ).map((r) => ({
            id: r.id,
            reference: r.accountName,
            party: r.accountType,
            date: null,
            currency: r.currency,
            amount: r.currentBalance,
            paid: zero(),
            balance: r.currentBalance,
            status: 'CURRENT',
            href: '/cash-desk/accounts',
          }));
        if (rows.length > 20000)
          throw new BadRequestException(
            'This report exceeds 20,000 records. Narrow the company, organisation or dates.',
          );
        const totals = new Map<
          string,
          {
            currency: string;
            amount: Prisma.Decimal;
            paid: Prisma.Decimal;
            balance: Prisma.Decimal;
            count: number;
          }
        >();
        for (const row of rows) {
          const t = totals.get(row.currency) ?? {
            currency: row.currency,
            amount: zero(),
            paid: zero(),
            balance: zero(),
            count: 0,
          };
          t.amount = t.amount.plus(row.amount);
          t.paid = t.paid.plus(row.paid);
          t.balance = t.balance.plus(row.balance);
          t.count++;
          totals.set(row.currency, t);
        }
        return {
          kind: q.kind,
          generatedAt: new Date().toISOString(),
          basis:
            'Business records only. Payments and balances are current; dates filter the originating documents. Direct registers and Records are excluded. Never add sales to receivables or purchase invoices to payables.',
          rows,
          totals: [...totals.values()],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
}
