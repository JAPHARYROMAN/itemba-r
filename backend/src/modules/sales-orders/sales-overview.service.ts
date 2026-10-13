import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService, OrganizationScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesOverviewQueryDto } from './dto/sales-overview-query.dto';
import { CONVENTIONAL_CODES } from '../../common/services/account-resolver.service';

const DAY = 86400000;
const MAX_RECORDS = 10000;
const confirmed = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] as const;
const decimal = (value: Prisma.Decimal | string | number) => new Prisma.Decimal(value);
const total = (values: (Prisma.Decimal | string | number)[]) =>
  values.reduce<Prisma.Decimal>((sum, value) => sum.plus(value), decimal(0));
const money = (value: Prisma.Decimal) => value.toFixed(2);
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const allocationBusinessDate = (timestamp: Date) =>
  new Date(`${dayKey(new Date(timestamp.getTime() + 3 * 3600000))}T00:00:00.000Z`);
// Business document dates are stored as UTC date-only values. The default day is EAT.
export function overviewPeriod(query: SalesOverviewQueryDto, now = new Date()) {
  const today = dayKey(new Date(now.getTime() + 3 * 3600000));
  const dateTo = query.dateTo ?? today;
  const dateFrom = query.dateFrom ?? `${dateTo.slice(0, 7)}-01`;
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);
  const days = (end.getTime() - start.getTime()) / DAY + 1;
  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > 366 ||
    dayKey(start) !== dateFrom ||
    dayKey(end) !== dateTo ||
    dateTo > today
  )
    throw new BadRequestException(
      'Choose a valid date range of up to 366 days ending today or earlier.',
    );
  const previousStart = new Date(start.getTime() - days * DAY);
  const previousEnd = new Date(start.getTime() - 1);
  return {
    dateFrom,
    dateTo,
    today,
    days,
    start,
    end: new Date(end.getTime() + DAY - 1),
    previousStart,
    previousEnd,
    previousFrom: dayKey(previousStart),
    previousTo: dayKey(previousEnd),
  };
}

/** Read-only dashboard projection. All sources share company and organization access checks. */
@Injectable()
export class SalesOverviewService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly organization: OrganizationScopeService,
  ) {}

  async read(user: AuthUser, query: SalesOverviewQueryDto) {
    if (!user.permissions.includes('sales.view'))
      throw new ForbiddenException('Sales access is required.');
    const period = overviewPeriod(query);
    const companyScope = await this.companies.companyWhereFor(user, query.companyId);
    const organizationScope = await this.organization.recordWhereFor(user);
    const grants = await this.organization.accessibleIds(user);
    const requestedScope = {
      ...(query.divisionId ? { divisionId: query.divisionId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };
    const headerVisible = (row: { divisionId: string | null; branchId: string | null }) =>
      (!query.divisionId || row.divisionId === query.divisionId) &&
      (!query.branchId || row.branchId === query.branchId) &&
      (grants.unrestricted ||
        grants.divisionIds.includes(row.divisionId ?? '') ||
        grants.branchIds.includes(row.branchId ?? ''));
    const scope = {
      deletedAt: null,
      AND: [companyScope, organizationScope, requestedScope],
    };
    const currency = query.currency ?? 'TZS';
    const salesScope = { ...scope, currency };
    const balancesVisible = user.permissions.includes('receivables.view');
    const receiptsVisible = ['cash_desk.view', 'receivables.view', 'customer-payments.view'].every(
      (permission) => user.permissions.includes(permission),
    );
    const customersVisible = user.permissions.includes('customers.view');
    return this.db.$transaction(
      async (tx) => {
        const orders = await tx.salesOrder.findMany({
          where: salesScope,
          select: {
            id: true,
            salesOrderNumber: true,
            companyId: true,
            customerId: true,
            customerName: true,
            customer: { select: { name: true } },
            orderDate: true,
            dueDate: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true,
            currency: true,
            totalAmount: true,
            paidAmount: true,
            outstandingAmount: true,
            receivableId: true,
            journalEntryId: true,
            createdAt: true,
            branchId: true,
            branch: { select: { name: true } },
            salespersonId: true,
            salesperson: { select: { firstName: true, lastName: true } },
          },
          orderBy: [{ orderDate: 'desc' }, { id: 'asc' }],
          take: MAX_RECORDS + 1,
        });
        this.checkLimit(orders);
        const live = orders.filter((order) =>
          (confirmed as readonly string[]).includes(order.status),
        );
        const liveIds = live.map((order) => order.id);
        const current = live.filter(
          (order) => order.orderDate >= period.start && order.orderDate <= period.end,
        );
        const previous = live.filter(
          (order) =>
            order.orderDate >= period.previousStart && order.orderDate <= period.previousEnd,
        );
        const [receivables, lines, newCustomers] = await Promise.all([
          balancesVisible
            ? tx.receivable.findMany({
                where: {
                  ...salesScope,
                  OR: [
                    {
                      id: {
                        in: live.flatMap((order) =>
                          order.receivableId ? [order.receivableId] : [],
                        ),
                      },
                    },
                    { sourceType: 'SalesOrder', sourceId: { in: liveIds } },
                  ],
                },
                select: {
                  id: true,
                  companyId: true,
                  sourceId: true,
                  journalEntryId: true,
                  paidAmount: true,
                  outstandingAmount: true,
                  dueDate: true,
                  status: true,
                },
                take: MAX_RECORDS + 1,
              })
            : [],
          tx.salesOrderLine.findMany({
            where: {
              salesOrder: { is: { ...salesScope, id: { in: current.map((order) => order.id) } } },
            },
            select: {
              productId: true,
              product: { select: { name: true } },
              unitId: true,
              unit: { select: { name: true } },
              quantity: true,
              lineTotal: true,
            },
            take: 50001,
          }),
          customersVisible
            ? tx.customer.count({
                where: {
                  ...scope,
                  createdAt: {
                    gte: new Date(period.start.getTime() - 3 * 3600000),
                    lte: new Date(period.end.getTime() - 3 * 3600000),
                  },
                },
              })
            : null,
        ]);
        this.checkLimit(receivables);
        if (lines.length > 50000)
          throw new BadRequestException('Choose a smaller date range to view product performance.');
        const byId = new Map(live.map((order) => [order.id, order]));
        const byReceivable = new Map(
          live.filter((order) => order.receivableId).map((order) => [order.receivableId!, order]),
        );
        const matched = receivables.flatMap((receivable) => {
          const sale = byReceivable.get(receivable.id) ?? byId.get(receivable.sourceId ?? '');
          return sale && sale.companyId === receivable.companyId ? [{ sale, receivable }] : [];
        });
        const matchedIds = matched.map(({ receivable }) => receivable.id);
        const matchedByReceivable = new Map(
          matched.map(({ sale, receivable }) => [receivable.id, sale]),
        );
        const receivableMap = new Map(matched.map(({ sale, receivable }) => [sale.id, receivable]));
        const payments = receiptsVisible
          ? await tx.customerPayment.findMany({
              where: {
                deletedAt: null,
                currency,
                AND: [
                  companyScope,
                  {
                    OR: [
                      { AND: [organizationScope, requestedScope] },
                      { allocations: { some: { receivableId: { in: matchedIds } } } },
                    ],
                  },
                  {
                    OR: [
                      { paymentDate: { gte: period.previousStart } },
                      {
                        allocations: {
                          some: {
                            createdAt: {
                              gte: new Date(period.previousStart.getTime() - 3 * 3600000),
                              lte: new Date(period.end.getTime() - 3 * 3600000),
                            },
                            receivableId: { in: matchedIds },
                          },
                        },
                      },
                    ],
                  },
                ],
                paymentDate: { lte: period.end },
                status: 'COMPLETED',
                journalEntry: {
                  is: {
                    status: 'POSTED',
                    deletedAt: null,
                    reversalOfId: null,
                    reversedBy_: { none: { status: 'POSTED', deletedAt: null } },
                  },
                },
              },
              select: {
                id: true,
                journalEntryId: true,
                paymentNumber: true,
                paymentDate: true,
                createdAt: true,
                divisionId: true,
                branchId: true,
                amount: true,
                method: true,
                unappliedAmount: true,
                _count: { select: { allocations: true } },
                allocations: {
                  where: { receivableId: { in: matchedIds } },
                  select: { receivableId: true, amount: true, createdAt: true },
                },
              },
              take: MAX_RECORDS + 1,
            })
          : [];
        this.checkLimit(payments);
        const journals = receiptsVisible
          ? await tx.journalEntry.findMany({
              where: {
                ...scope,
                status: 'POSTED',
                deletedAt: null,
                reversalOfId: null,
                reversedBy_: { none: { status: 'POSTED', deletedAt: null } },
                transactionDate: { gte: period.previousStart, lte: period.end },
                // Payment allocation receipts are counted below, never again as their journals.
                id: {
                  notIn: payments.flatMap((payment) =>
                    payment.journalEntryId ? [payment.journalEntryId] : [],
                  ),
                },
                OR: [
                  {
                    referenceType: 'SalesOrder',
                    id: {
                      in: live.flatMap((sale) =>
                        sale.journalEntryId ? [sale.journalEntryId] : [],
                      ),
                    },
                  },
                  {
                    referenceType: 'Receivable',
                    referenceId: { in: matchedIds },
                    id: {
                      notIn: receivables.flatMap((receivable) =>
                        receivable.journalEntryId ? [receivable.journalEntryId] : [],
                      ),
                    },
                    lines: { some: { debit: { gt: 0 }, account: { accountType: 'ASSET' } } },
                  },
                ],
              },
              select: {
                id: true,
                journalNumber: true,
                transactionDate: true,
                referenceType: true,
                referenceId: true,
                description: true,
                lines: {
                  select: {
                    debit: true,
                    credit: true,
                    account: {
                      select: {
                        accountCode: true,
                        accountSubType: true,
                        mappedCashAccount: { select: { currency: true } },
                      },
                    },
                  },
                },
              },
              take: MAX_RECORDS + 1,
            })
          : [];
        this.checkLimit(journals);
        const roleAmount = (
          journal: (typeof journals)[number],
          roles: Array<'CASH_ON_HAND' | 'BANK' | 'AR_CONTROL'>,
        ) =>
          total(
            journal.lines
              .filter((line) =>
                roles.some(
                  (role) =>
                    line.account.accountSubType?.toLowerCase() === role.toLowerCase() ||
                    ((role === 'CASH_ON_HAND' || role === 'BANK') &&
                      line.account.mappedCashAccount?.currency === currency) ||
                    (!line.account.accountSubType &&
                      CONVENTIONAL_CODES[role].includes(line.account.accountCode)),
                ),
              )
              .map((line) => line.debit.minus(line.credit)),
          );
        let scopedCollections = false;
        const warnings: string[] = [];
        const receiptRows: Array<{
          id: string;
          reference: string;
          date: Date;
          amount: Prisma.Decimal;
          method: string;
          saleId: string;
        }> = journals.flatMap((journal) => {
          const sale =
            journal.referenceType === 'SalesOrder'
              ? byId.get(journal.referenceId ?? '')
              : matchedByReceivable.get(journal.referenceId ?? '');
          if (!sale) return [];
          const cash = roleAmount(journal, ['CASH_ON_HAND', 'BANK']);
          const ar = roleAmount(journal, ['AR_CONTROL']);
          const saleReceipt = journal.referenceType === 'SalesOrder';
          const verified =
            cash.gt(0) &&
            (saleReceipt
              ? ar.gte(0) && sale.totalAmount.minus(ar).minus(cash).abs().lte('0.01')
              : /^Receivable settlement /i.test(journal.description) && ar.negated().equals(cash));
          if (!verified) {
            if (cash.gt(0))
              warnings.push(
                'A linked receipt journal could not be reconciled and is excluded from collections.',
              );
            return [];
          }
          return [
            {
              id: journal.id,
              reference: journal.journalNumber,
              date: journal.transactionDate,
              amount: cash,
              method: saleReceipt && sale.paymentMethod !== 'CREDIT' ? sale.paymentMethod : 'OTHER',
              saleId: sale.id,
            },
          ];
        });
        for (const payment of payments) {
          const allocations = payment.allocations.filter((allocation) =>
            matchedByReceivable.has(allocation.receivableId),
          );
          const visible = headerVisible(payment);
          const partial =
            !visible ||
            payment._count.allocations > allocations.length ||
            total(allocations.map((allocation) => allocation.amount)).lt(payment.amount);
          for (const allocation of allocations) {
            const later = allocation.createdAt.getTime() > payment.createdAt.getTime() + 1000;
            const effectiveDate = later
              ? new Date(
                  Math.max(
                    payment.paymentDate.getTime(),
                    allocationBusinessDate(allocation.createdAt).getTime(),
                  ),
                )
              : payment.paymentDate;
            if (effectiveDate > period.end) continue;
            if (partial || later) scopedCollections = true;
            receiptRows.push({
              id: visible
                ? `${payment.id}:${allocation.receivableId}`
                : `allocation-${createHash('sha256').update(`${payment.id}:${allocation.receivableId}`).digest('hex').slice(0, 24)}`,
              reference: visible ? payment.paymentNumber : 'Invoice payment allocation',
              date: effectiveDate,
              amount: allocation.amount,
              method: visible ? payment.method : 'OTHER',
              saleId: matchedByReceivable.get(allocation.receivableId)!.id,
            });
          }
        }
        const receipts = receiptRows.filter(
          (row) => row.date >= period.start && row.date <= period.end,
        );
        const previousReceipts = receiptRows.filter(
          (row) => row.date >= period.previousStart && row.date <= period.previousEnd,
        );
        const owed = matched.filter(
          ({ receivable }) =>
            ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'].includes(receivable.status) &&
            receivable.outstandingAmount.gt(0),
        );
        const overdue = owed.filter(
          ({ receivable }) => receivable.dueDate && dayKey(receivable.dueDate) < period.today,
        );
        const nextWeek = dayKey(
          new Date(new Date(`${period.today}T00:00:00Z`).getTime() + 7 * DAY),
        );
        const upcoming = owed.filter(
          ({ receivable }) =>
            receivable.dueDate &&
            dayKey(receivable.dueDate) >= period.today &&
            dayKey(receivable.dueDate) <= nextWeek,
        );
        const salesValue = total(current.map((order) => order.totalAmount));
        const previousValue = total(previous.map((order) => order.totalAmount));
        const serializeSale = (sale: (typeof orders)[number]) => ({
          id: sale.id,
          reference: sale.salesOrderNumber,
          date: dayKey(sale.orderDate),
          customerId: sale.customerId,
          customer: sale.customer?.name ?? sale.customerName ?? 'Walk-in customer',
          branch: sale.branch?.name ?? 'Company',
          status: sale.status,
          paymentStatus: sale.paymentStatus,
          amount: money(sale.totalAmount),
          outstanding: balancesVisible
            ? money(receivableMap.get(sale.id)?.outstandingAmount ?? sale.outstandingAmount)
            : null,
        });
        const rank = (
          groups: Map<string, { id: string; name: string; amount: Prisma.Decimal; count: number }>,
        ) =>
          [...groups.values()]
            .sort((a, b) => b.amount.comparedTo(a.amount))
            .slice(0, 5)
            .map((row) => ({ ...row, amount: money(row.amount) }));
        const customerGroups = new Map<
          string,
          { id: string; name: string; amount: Prisma.Decimal; count: number }
        >();
        const branchGroups = new Map<
          string,
          { id: string; name: string; amount: Prisma.Decimal; count: number }
        >();
        const salespersonGroups = new Map<
          string,
          { id: string; name: string; amount: Prisma.Decimal; count: number }
        >();
        for (const order of current) {
          const add = (groups: typeof customerGroups, id: string, name: string) => {
            const row = groups.get(id) ?? { id, name, amount: decimal(0), count: 0 };
            row.amount = row.amount.plus(order.totalAmount);
            row.count++;
            groups.set(id, row);
          };
          if (order.customerId && customersVisible)
            add(
              customerGroups,
              order.customerId,
              order.customer?.name ?? order.customerName ?? 'Customer',
            );
          add(branchGroups, order.branchId ?? '', order.branch?.name ?? 'Company sales');
          add(
            salespersonGroups,
            order.salespersonId ?? '',
            order.salesperson
              ? `${order.salesperson.firstName} ${order.salesperson.lastName}`
              : 'Unassigned',
          );
        }
        const productGroups = new Map<
          string,
          {
            id: string;
            name: string;
            unit: string;
            quantity: Prisma.Decimal;
            amount: Prisma.Decimal;
          }
        >();
        for (const line of lines) {
          const key = `${line.productId}:${line.unitId}`;
          const row = productGroups.get(key) ?? {
            id: key,
            name: line.product.name,
            unit: line.unit.name,
            quantity: decimal(0),
            amount: decimal(0),
          };
          row.quantity = row.quantity.plus(line.quantity);
          row.amount = row.amount.plus(line.lineTotal);
          productGroups.set(key, row);
        }
        const bucketSize = Math.max(1, Math.ceil(period.days / 31));
        const trend = Array.from({ length: Math.ceil(period.days / bucketSize) }, (_, index) => {
          const start = new Date(period.start.getTime() + index * bucketSize * DAY);
          const end = new Date(
            Math.min(period.end.getTime(), start.getTime() + bucketSize * DAY - 1),
          );
          return {
            date: dayKey(start),
            dateTo: dayKey(end),
            sales: money(
              total(
                current
                  .filter((order) => order.orderDate >= start && order.orderDate <= end)
                  .map((order) => order.totalAmount),
              ),
            ),
            collected: receiptsVisible
              ? money(
                  total(
                    receipts
                      .filter((receipt) => receipt.date >= start && receipt.date <= end)
                      .map((receipt) => receipt.amount),
                  ),
                )
              : null,
          };
        });
        const aging = [
          { label: 'Not overdue', min: -Infinity, max: 0 },
          { label: '1–30 days', min: 1, max: 30 },
          { label: '31–60 days', min: 31, max: 60 },
          { label: '61–90 days', min: 61, max: 90 },
          { label: '91+ days', min: 91, max: Infinity },
        ].map((bucket) => ({
          label: bucket.label,
          amount: money(
            total(
              owed
                .filter(({ receivable }) => {
                  const age = receivable.dueDate
                    ? Math.round(
                        (new Date(`${period.today}T00:00:00Z`).getTime() -
                          new Date(`${dayKey(receivable.dueDate)}T00:00:00Z`).getTime()) /
                          DAY,
                      )
                    : 0;
                  return age >= bucket.min && age <= bucket.max;
                })
                .map(({ receivable }) => receivable.outstandingAmount),
            ),
          ),
        }));
        const drafts = orders.filter((order) => order.status === 'DRAFT');
        return {
          currency,
          receiptBasis: receiptsVisible
            ? scopedCollections
              ? 'scoped-settlements'
              : 'actual-receipts'
            : null,
          warnings: [...new Set(warnings)],
          period: {
            dateFrom: period.dateFrom,
            dateTo: period.dateTo,
            previousFrom: period.previousFrom,
            previousTo: period.previousTo,
          },
          asOf: period.today,
          access: {
            balances: balancesVisible,
            receipts: receiptsVisible,
            customers: customersVisible,
          },
          metrics: {
            salesValue: money(salesValue),
            salesCount: current.length,
            averageSale: money(current.length ? salesValue.div(current.length) : decimal(0)),
            collected: receiptsVisible
              ? money(total(receipts.map((receipt) => receipt.amount)))
              : null,
            outstanding: balancesVisible
              ? money(total(owed.map(({ receivable }) => receivable.outstandingAmount)))
              : null,
            overdue: balancesVisible
              ? money(total(overdue.map(({ receivable }) => receivable.outstandingAmount)))
              : null,
            previousSalesValue: money(previousValue),
            previousSalesCount: previous.length,
            previousAverageSale: money(
              previous.length ? previousValue.div(previous.length) : decimal(0),
            ),
            previousCollected: receiptsVisible
              ? money(total(previousReceipts.map((receipt) => receipt.amount)))
              : null,
            purchasingCustomers: customersVisible
              ? new Set(current.flatMap((order) => (order.customerId ? [order.customerId] : [])))
                  .size
              : null,
            newCustomers,
          },
          trend,
          aging: balancesVisible ? aging : [],
          salesMix: ['CASH', 'CREDIT']
            .map((kind) => {
              const subset = current.filter(
                (order) => (order.paymentMethod === 'CREDIT') === (kind === 'CREDIT'),
              );
              return {
                label: kind === 'CREDIT' ? 'Credit sales' : 'Immediate payment',
                amount: money(total(subset.map((order) => order.totalAmount))),
                count: subset.length,
              };
            })
            .filter((row) => row.count),
          paymentMethods: receiptsVisible
            ? [...new Set(receipts.map((receipt) => receipt.method))].map((method) => ({
                label: method.replace(/_/g, ' '),
                amount: money(
                  total(
                    receipts
                      .filter((receipt) => receipt.method === method)
                      .map((receipt) => receipt.amount),
                  ),
                ),
              }))
            : [],
          topCustomers: rank(customerGroups),
          branches: rank(branchGroups),
          salespeople: rank(salespersonGroups),
          topProducts: [...productGroups.values()]
            .sort((a, b) => b.amount.comparedTo(a.amount))
            .slice(0, 5)
            .map((row) => ({
              ...row,
              quantity: row.quantity.toString(),
              amount: money(row.amount),
            })),
          attention: {
            drafts: drafts.length,
            overdue: balancesVisible ? overdue.length : null,
            dueSoon: balancesVisible ? upcoming.length : null,
            unappliedPayments: receiptsVisible
              ? payments.filter(
                  (payment) =>
                    headerVisible(payment) &&
                    payment.paymentDate >= period.start &&
                    payment.unappliedAmount.gt(0),
                ).length
              : null,
            draftSales: drafts.slice(0, 3).map(serializeSale),
            dueSoonSales: upcoming
              .sort((a, b) => a.receivable.dueDate!.getTime() - b.receivable.dueDate!.getTime())
              .slice(0, 5)
              .map(({ sale, receivable }) => ({
                ...serializeSale(sale),
                outstanding: money(receivable.outstandingAmount),
                dueDate: dayKey(receivable.dueDate!),
              })),
            overdueSales: overdue
              .sort((a, b) =>
                b.receivable.outstandingAmount.comparedTo(a.receivable.outstandingAmount),
              )
              .slice(0, 5)
              .map(({ sale, receivable }) => ({
                ...serializeSale(sale),
                outstanding: money(receivable.outstandingAmount),
                dueDate: receivable.dueDate ? dayKey(receivable.dueDate) : null,
              })),
          },
          recentSales: orders
            .filter((order) => order.orderDate >= period.start && order.orderDate <= period.end)
            .slice(0, 8)
            .map(serializeSale),
          recentReceipts: receipts
            .sort((a, b) => b.date.getTime() - a.date.getTime())
            .slice(0, 5)
            .map((receipt) => ({
              ...receipt,
              date: dayKey(receipt.date),
              amount: money(receipt.amount),
            })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
  }

  private checkLimit(rows: unknown[]) {
    if (rows.length > MAX_RECORDS)
      throw new BadRequestException(
        'Choose a smaller company, division or branch to view the sales overview.',
      );
  }
}
