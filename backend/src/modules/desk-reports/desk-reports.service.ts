import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DeskReportQuery } from './desk-reports.dto';
import { reportPeriod, tradeReport } from './desk-reports.domain';
import { cashReport } from './desk-reports.cash';
const limit = 20000;
const names = {
  company: { select: { name: true } },
  division: { select: { name: true } },
  branch: { select: { name: true } },
} as const;
@Injectable()
export class DeskReportsService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
  ) {}
  private async scope(user: AuthUser, q: DeskReportQuery) {
    return {
      AND: [
        await this.companies.companyWhereFor(user, q.companyId),
        await this.org.recordWhereFor(user),
        { divisionId: q.divisionId, branchId: q.branchId },
      ],
    };
  }
  private check(count: number) {
    if (count > limit)
      throw new BadRequestException(
        'This report exceeds 20,000 source records. Select a company, branch or counterparty to narrow the report.',
      );
  }
  async sales(user: AuthUser, q: DeskReportQuery) {
    const period = reportPeriod(q),
      scope = await this.scope(user, q);
    return this.db.$transaction(
      async (tx) => {
        const where: Prisma.SalesDeskSaleWhereInput = {
          AND: [
            scope,
            {
              voidedAt: null,
              currency: q.currency,
              customerId: q.partyId,
              saleDate: { lte: new Date(period.to) },
            },
          ],
        };
        this.check(await tx.salesDeskSale.count({ where }));
        this.check(
          await tx.salesDeskPayment.count({
            where: { sale: where, reversedAt: null, paymentDate: { lte: new Date(period.to) } },
          }),
        );
        const docs = await tx.salesDeskSale.findMany({
          where,
          include: {
            ...names,
            customer: { select: { name: true } },
            payments: {
              where: { reversedAt: null, paymentDate: { lte: new Date(period.to) } },
              select: { id: true, amount: true, paymentDate: true, reference: true },
            },
          },
          orderBy: [{ saleDate: 'asc' }, { id: 'asc' }],
        });
        return tradeReport(
          docs.map((d) => ({
            ...d,
            reference: d.saleNumber,
            date: d.saleDate,
            amount: d.totalAmount,
            partyId: d.customerId,
            party: d.customer.name,
            company: d.company.name,
            division: d.division.name,
            branch: d.branch.name,
            payments: d.payments.map((p) => ({ ...p, date: p.paymentDate })),
          })),
          q,
          'Sales Desk',
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
  async purchases(user: AuthUser, q: DeskReportQuery) {
    const period = reportPeriod(q),
      scope = await this.scope(user, q);
    return this.db.$transaction(
      async (tx) => {
        const where: Prisma.InvoiceDeskInvoiceWhereInput = {
          AND: [
            scope,
            {
              voidedAt: null,
              currency: q.currency,
              supplierId: q.partyId,
              invoiceDate: { lte: new Date(period.to) },
            },
          ],
        };
        this.check(await tx.invoiceDeskInvoice.count({ where }));
        this.check(
          await tx.invoiceDeskPayment.count({
            where: { invoice: where, reversedAt: null, paymentDate: { lte: new Date(period.to) } },
          }),
        );
        const docs = await tx.invoiceDeskInvoice.findMany({
          where,
          include: {
            ...names,
            supplier: { select: { name: true } },
            payments: {
              where: { reversedAt: null, paymentDate: { lte: new Date(period.to) } },
              select: { id: true, amount: true, paymentDate: true, reference: true },
            },
          },
          orderBy: [{ invoiceDate: 'asc' }, { id: 'asc' }],
        });
        return tradeReport(
          docs.map((d) => ({
            ...d,
            reference: d.invoiceNumber,
            date: d.invoiceDate,
            amount: d.totalAmount,
            partyId: d.supplierId,
            party: d.supplier.name,
            company: d.company.name,
            division: d.division.name,
            branch: d.branch.name,
            payments: d.payments.map((p) => ({ ...p, date: p.paymentDate })),
          })),
          q,
          'Invoice Desk',
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
  async cash(user: AuthUser, q: DeskReportQuery) {
    const period = reportPeriod(q),
      scope = await this.scope(user, q);
    return this.db.$transaction(
      async (tx) => {
        const account = { AND: [scope, { currency: q.currency }] };
        const where: Prisma.CashDeskEntryWhereInput = {
          account,
          businessDate: { lte: new Date(period.to) },
        };
        this.check(await tx.cashDeskEntry.count({ where }));
        const entries = await tx.cashDeskEntry.findMany({
          where,
          include: {
            account: { include: names },
            movement: {
              select: {
                id: true,
                kind: true,
                description: true,
                reference: true,
                payee: true,
                expenseCategory: true,
                reversedAt: true,
                reversalOfId: true,
              },
            },
          },
          orderBy: [{ businessDate: 'asc' }, { id: 'asc' }],
        });
        return cashReport(entries, q);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
}
