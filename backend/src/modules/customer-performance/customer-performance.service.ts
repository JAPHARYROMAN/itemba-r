import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CustomerAccountProjectionService } from '../customer-statements/customer-account-projection.service';
import { CustomerAccountSnapshot } from '../customer-statements/customer-account-projection.types';
import { CustomerPerformanceQueryDto, PerformanceCategory } from './customer-performance.dto';
import { CustomerPaymentHistoryRow, CustomerPerformanceRow } from './customer-performance.types';

const DAY = 86400000;
const D = (value: Prisma.Decimal | string | number) => new Prisma.Decimal(value);
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), D(0));
const day = (value: Date) => value.toISOString().slice(0, 10);
const money = (value: Prisma.Decimal) => value.toFixed(2);
const minimum = (left: Prisma.Decimal, right: Prisma.Decimal) => (left.lt(right) ? left : right);
export const CUSTOMER_PERFORMANCE_RULES = {
  minimumDueInvoices: 5,
  bestOnTimePercent: 95,
  goodOnTimePercent: 90,
  topSalesPercent: 20,
  salesBasis: 'Document value after credit adjustments, including tax',
};

/** Calendar periods use the same EAT business day as Sales Desk. */
export function customerPerformancePeriod(query: CustomerPerformanceQueryDto, now = new Date()) {
  const today = day(new Date(now.getTime() + 3 * 3600000));
  const dateTo = query.dateTo ?? today;
  const endDay = new Date(`${dateTo}T00:00:00.000Z`);
  const dateFrom =
    query.dateFrom ??
    (Number.isNaN(endDay.getTime()) ? '' : day(new Date(endDay.getTime() - 89 * DAY)));
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const days = (endDay.getTime() - start.getTime()) / DAY + 1;
  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > 366 ||
    dateTo > today ||
    day(start) !== dateFrom ||
    day(endDay) !== dateTo
  ) {
    throw new BadRequestException(
      'Choose a valid date range of up to 366 days ending today or earlier.',
    );
  }
  return {
    today,
    dateFrom,
    dateTo,
    start,
    end: new Date(endDay.getTime() + DAY - 1),
    previousStart: new Date(start.getTime() - days * DAY),
    previousEnd: new Date(start.getTime() - 1),
    previousFrom: day(new Date(start.getTime() - days * DAY)),
    previousTo: day(new Date(start.getTime() - 1)),
  };
}

type Period = ReturnType<typeof customerPerformancePeriod>;
export function customerPerformanceAccess(user: AuthUser) {
  return {
    sales: true,
    balances: user.permissions.includes('receivables.view'),
    receipts: ['receivables.view', 'cash_desk.view', 'customer-payments.view'].every((permission) =>
      user.permissions.includes(permission),
    ),
  };
}
type Access = ReturnType<typeof customerPerformanceAccess>;

function inRange(date: Date, from: Date, to: Date) {
  return date >= from && date <= to;
}
function activePayment(payment: { reversedAt: Date | null }, today: string) {
  return !payment.reversedAt || day(payment.reversedAt) > today;
}
function invoiceOwedAtDue(
  account: CustomerAccountSnapshot,
  invoice: CustomerAccountSnapshot['obligations'][number],
) {
  const credits = sum(
    account.movements
      .filter((movement) => {
        if (movement.receivableId !== invoice.id || day(movement.date) > day(invoice.dueDate!))
          return false;
        if (movement.type === 'CREDIT_NOTE' || movement.sourceType === 'CreditNote') return true;
        return (
          movement.type === 'ADJUSTMENT' &&
          movement.credit.gt(0) &&
          !!movement.reversalOfId &&
          account.movements.some(
            (original) =>
              original.type === 'INVOICE' &&
              original.debit.gt(0) &&
              `${original.sourceType}:${original.sourceId}` === movement.reversalOfId,
          )
        );
      })
      .map((movement) => movement.credit.minus(movement.debit)),
  );
  return Prisma.Decimal.max(0, invoice.amount.minus(credits));
}
function netSales(account: CustomerAccountSnapshot, from: Date, to: Date) {
  const sales = sum(
    account.sales.filter((sale) => inRange(sale.date, from, to)).map((sale) => sale.totalAmount),
  );
  const credits = sum(
    account.movements
      .filter(
        (movement) =>
          inRange(movement.date, from, to) &&
          movement.salesOrderId &&
          (movement.type === 'CREDIT_NOTE' || movement.sourceType === 'CreditNote'),
      )
      .map((movement) => movement.credit.minus(movement.debit)),
  );
  // The original invoice and its dated reversal are distinct movements; refunds
  // settle the resulting customer credit and never reduce sales a second time.
  const saleReversals = sum(
    account.movements
      .filter(
        (movement) =>
          inRange(movement.date, from, to) &&
          movement.salesOrderId &&
          movement.reversalOfId &&
          movement.type === 'ADJUSTMENT' &&
          movement.credit.gt(0) &&
          account.movements.some(
            (original) =>
              original.type === 'INVOICE' &&
              original.debit.gt(0) &&
              `${original.sourceType}:${original.sourceId}` === movement.reversalOfId,
          ),
      )
      .map((movement) => movement.credit.minus(movement.debit)),
  );
  return sales.minus(credits).minus(saleReversals);
}

/** Derives classification from complete scoped records, before table pagination. */
export function customerPerformanceRows(
  accounts: CustomerAccountSnapshot[],
  period: Period,
  access: Access,
): CustomerPerformanceRow[] {
  const raw = accounts.map((account) => {
    const sales = account.sales.filter((sale) => inRange(sale.date, period.start, period.end));
    const eligible = account.obligations.filter(
      (invoice) =>
        invoice.dueDate &&
        invoice.amount.gt(0) &&
        inRange(invoice.dueDate, period.start, period.end) &&
        day(invoice.dueDate) < period.today,
    );
    let dueAmount = D(0),
      paidOnTime = D(0);
    for (const invoice of eligible) {
      const dueDate = day(invoice.dueDate!);
      const owed = invoiceOwedAtDue(account, invoice);
      const onTime = sum(
        invoice.payments
          .filter(
            (payment) => day(payment.date) <= dueDate && activePayment(payment, period.dateTo),
          )
          .map((payment) => payment.amount),
      );
      dueAmount = dueAmount.plus(owed);
      paidOnTime = paidOnTime.plus(minimum(owed, onTime));
    }
    const eligibleCount = eligible.filter((invoice) =>
      invoiceOwedAtDue(account, invoice).gt(0),
    ).length;
    const overdueInvoices = account.obligations.filter(
      (invoice) =>
        invoice.outstanding.gt(0) && invoice.dueDate && day(invoice.dueDate) < period.today,
    );
    const overdue = sum(overdueInvoices.map((invoice) => invoice.outstanding));
    const oldestDaysOverdue = overdueInvoices.reduce(
      (oldest, invoice) =>
        Math.max(
          oldest,
          Math.round(
            (new Date(`${period.today}T00:00:00Z`).getTime() -
              new Date(`${day(invoice.dueDate!)}T00:00:00Z`).getTime()) /
              DAY,
          ),
        ),
      0,
    );
    const posted = account.payments.filter(
      (payment) => payment.status === 'COMPLETED' || payment.status === 'REVERSED',
    );
    const completed = posted.filter((payment) => activePayment(payment, period.today));
    const last = completed.reduce<Date | null>(
      (latest, payment) => (!latest || payment.date > latest ? payment.date : latest),
      null,
    );
    return {
      account,
      sales,
      eligibleCount,
      overdue,
      oldestDaysOverdue,
      amount: netSales(account, period.start, period.end),
      previous: netSales(account, period.previousStart, period.previousEnd),
      collected: sum(
        posted
          .filter((payment) => inRange(payment.date, period.start, period.end))
          .map((payment) => payment.amount),
      ).minus(
        sum(
          posted
            .filter(
              (payment) =>
                payment.reversedAt && inRange(payment.reversedAt, period.start, period.end),
            )
            .map((payment) => payment.amount),
        ),
      ),
      last,
      // Never round a value just below a rating threshold up to that threshold.
      onTime: dueAmount.gt(0)
        ? paidOnTime
            .div(dueAmount)
            .times(100)
            .toDecimalPlaces(1, Prisma.Decimal.ROUND_DOWN)
            .toNumber()
        : null,
      missingDue: account.obligations.filter(
        (invoice) =>
          !invoice.dueDate &&
          invoice.amount.gt(0) &&
          (invoice.outstanding.gt(0) || inRange(invoice.issueDate, period.start, period.end)),
      ).length,
    };
  });
  const ranked = raw
    .filter((row) => row.amount.gt(0))
    .sort(
      (a, b) =>
        b.amount.comparedTo(a.amount) || a.account.customer.id.localeCompare(b.account.customer.id),
    );
  const ranks = new Map<string, number>();
  ranked.forEach((row, index) =>
    ranks.set(
      row.account.customer.id,
      index && row.amount.eq(ranked[index - 1].amount)
        ? ranks.get(ranked[index - 1].account.customer.id)!
        : index + 1,
    ),
  );
  const bestRank = Math.ceil((ranked.length * CUSTOMER_PERFORMANCE_RULES.topSalesPercent) / 100);
  return raw.map((row) => {
    const rank = ranks.get(row.account.customer.id) ?? null;
    const enough =
      row.eligibleCount >= CUSTOMER_PERFORMANCE_RULES.minimumDueInvoices &&
      row.onTime !== null &&
      row.missingDue === 0;
    const cashOnly =
      row.account.obligations.length === 0 &&
      row.sales.length > 0 &&
      row.sales.every((sale) => sale.paymentMethod !== 'CREDIT');
    const reasons: string[] = [];
    let category: PerformanceCategory;
    let paymentLabel: CustomerPerformanceRow['paymentLabel'];
    if (!access.balances || !access.receipts) {
      category = row.sales.length ? 'insufficient-history' : 'inactive';
      paymentLabel = 'restricted';
      reasons.push('Payment reliability requires access to balances and receipts.');
    } else if (
      row.account.settlementHistory?.status === 'INCOMPLETE' ||
      row.account.integrityIssues?.length
    ) {
      category = 'insufficient-history';
      paymentLabel = 'insufficient-history';
      reasons.push('Resolve incomplete account history before assessing payment reliability.');
    } else if (row.overdue.gt(0)) {
      category = 'needs-attention';
      paymentLabel = 'needs-attention';
      reasons.push(
        `${money(row.overdue)} overdue; oldest unpaid invoice is ${row.oldestDaysOverdue} days late.`,
      );
    } else if (enough && row.onTime! < CUSTOMER_PERFORMANCE_RULES.goodOnTimePercent) {
      category = 'needs-attention';
      paymentLabel = 'needs-attention';
      reasons.push(`${row.onTime!.toFixed(1)}% of matured invoice value paid on time.`);
    } else if (!row.sales.length) {
      category = 'inactive';
      paymentLabel = enough ? 'reliable' : 'insufficient-history';
      reasons.push('No business sales in this period.');
    } else if (!enough || row.missingDue > 0) {
      category = 'insufficient-history';
      paymentLabel = cashOnly ? 'paid-at-sale' : 'insufficient-history';
      reasons.push(
        cashOnly
          ? 'Paid at sale; no credit-payment history to rate.'
          : `${row.eligibleCount} eligible due invoices; at least ${CUSTOMER_PERFORMANCE_RULES.minimumDueInvoices} are required.`,
      );
      if (row.missingDue) reasons.push(`${row.missingDue} invoices have no due date.`);
    } else if (
      rank &&
      rank <= bestRank &&
      row.onTime! >= CUSTOMER_PERFORMANCE_RULES.bestOnTimePercent
    ) {
      category = 'best';
      paymentLabel = 'reliable';
      reasons.push(
        `Top ${CUSTOMER_PERFORMANCE_RULES.topSalesPercent}% by net sales, ${row.onTime!.toFixed(1)}% paid on time, no overdue balance.`,
      );
    } else {
      category = 'good';
      paymentLabel = 'reliable';
      reasons.push(`${row.onTime!.toFixed(1)}% paid on time, no overdue balance.`);
    }
    return {
      id: row.account.customer.id,
      companyId: row.account.customer.companyId,
      code: row.account.customer.customerCode,
      name: row.account.customer.name,
      category,
      reasons,
      salesRank: rank,
      netSales: money(row.amount),
      previousNetSales: money(row.previous),
      salesCount: row.sales.length,
      collected: access.receipts ? money(row.collected) : null,
      receiptBasis: access.receipts
        ? row.account.warnings.some((warning) => warning.startsWith('Scoped receipt:'))
          ? 'scoped-settlements'
          : 'actual-receipts'
        : null,
      lastPaymentDate: access.receipts && row.last ? day(row.last) : null,
      outstanding: access.balances ? money(row.account.openInvoiceBalance) : null,
      overdue: access.balances ? money(row.overdue) : null,
      customerCredit: access.receipts ? money(row.account.customerCredit) : null,
      netDue: access.receipts && access.balances ? money(row.account.netBalance) : null,
      oldestDaysOverdue: access.balances ? row.oldestDaysOverdue : null,
      onTimePercent:
        access.receipts &&
        access.balances &&
        row.account.settlementHistory?.status !== 'INCOMPLETE' &&
        !row.account.integrityIssues?.length &&
        row.onTime !== null
          ? Number(row.onTime.toFixed(1))
          : null,
      eligibleInvoiceCount: access.receipts && access.balances ? row.eligibleCount : null,
      missingDueDateCount: access.balances ? row.missingDue : null,
      paymentLabel,
    };
  });
}

@Injectable()
export class CustomerPerformanceService {
  constructor(private readonly projection: CustomerAccountProjectionService) {}

  private assertAccess(user: AuthUser) {
    if (
      !['customers.view', 'sales.view'].every((permission) => user.permissions.includes(permission))
    )
      throw new ForbiddenException('Customer and sales access are required.');
  }
  private pagination(query: CustomerPerformanceQueryDto) {
    const page = query.page ?? 1,
      limit = query.limit ?? 25;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger((page - 1) * limit)
    )
      throw new BadRequestException('Choose a valid page and a page size from 1 to 100.');
    return { page, limit, offset: (page - 1) * limit };
  }
  private async load(user: AuthUser, query: CustomerPerformanceQueryDto) {
    this.assertAccess(user);
    const period = customerPerformancePeriod(query);
    const access = customerPerformanceAccess(user);
    const data = await this.projection.read(user, {
      companyId: query.companyId,
      divisionId: query.divisionId,
      branchId: query.branchId,
      currency: query.currency,
      dateTo: period.today,
    });
    return { data, period, access, rows: customerPerformanceRows(data.accounts, period, access) };
  }

  async read(user: AuthUser, query: CustomerPerformanceQueryDto) {
    const pagination = this.pagination(query);
    const { data, period, access, rows } = await this.load(user, query);
    const search = query.search?.trim().toLocaleLowerCase();
    const searched = rows.filter(
      (row) => !search || `${row.name} ${row.code}`.toLocaleLowerCase().includes(search),
    );
    const filtered = searched.filter((row) => !query.category || row.category === query.category);
    const sort = query.sort ?? 'net-sales';
    filtered.sort((a, b) => {
      const metric =
        sort === 'collected' ? 'collected' : sort === 'overdue' ? 'overdue' : 'netSales';
      const difference = sort === 'name' ? 0 : D(b[metric] ?? 0).comparedTo(D(a[metric] ?? 0));
      return difference || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
    const totalField = (
      field: 'netSales' | 'collected' | 'outstanding' | 'overdue' | 'customerCredit' | 'netDue',
      allowed = true,
    ) => (allowed ? money(sum(searched.map((row) => D(row[field] ?? 0)))) : null);
    return {
      period: {
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
        previousFrom: period.previousFrom,
        previousTo: period.previousTo,
      },
      asOf: period.today,
      reliabilityAsOf: period.dateTo,
      currency: data.currency,
      access,
      rules: CUSTOMER_PERFORMANCE_RULES,
      coverage: 'business-sales',
      receiptBasis: access.receipts
        ? searched.some((row) => row.receiptBasis === 'scoped-settlements')
          ? 'scoped-settlements'
          : 'actual-receipts'
        : null,
      warnings:
        access.receipts && access.balances
          ? [
              ...new Set([
                ...data.warnings,
                ...data.accounts.flatMap((account) => account.warnings),
              ]),
            ]
          : [],
      summary: {
        customers: searched.length,
        best: searched.filter((row) => row.category === 'best').length,
        good: searched.filter((row) => row.category === 'good').length,
        needsAttention: searched.filter((row) => row.category === 'needs-attention').length,
        insufficientHistory: searched.filter((row) => row.category === 'insufficient-history')
          .length,
        inactive: searched.filter((row) => row.category === 'inactive').length,
        netSales: totalField('netSales'),
        collected: totalField('collected', access.receipts),
        outstanding: totalField('outstanding', access.balances),
        overdue: totalField('overdue', access.balances),
        customerCredit: totalField('customerCredit', access.receipts),
        netDue: totalField('netDue', access.receipts && access.balances),
      },
      rows: filtered.slice(pagination.offset, pagination.offset + pagination.limit),
      total: filtered.length,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async history(user: AuthUser, id: string, query: CustomerPerformanceQueryDto) {
    const pagination = this.pagination(query);
    const { data, period, access, rows } = await this.load(user, query);
    const account = data.accounts.find((item) => item.customer.id === id);
    if (!account) throw new NotFoundException('Customer not found in this scope.');
    const activityDate = (payment: CustomerAccountSnapshot['payments'][number]) =>
      payment.reversedAt && inRange(payment.reversedAt, period.start, period.end)
        ? payment.reversedAt
        : payment.date;
    const history: CustomerPaymentHistoryRow[] = (access.receipts ? account.payments : [])
      .filter(
        (payment) =>
          inRange(payment.date, period.start, period.end) ||
          (payment.reversedAt && inRange(payment.reversedAt, period.start, period.end)),
      )
      .sort(
        (a, b) => activityDate(b).getTime() - activityDate(a).getTime() || a.id.localeCompare(b.id),
      )
      .map((payment) => ({
        id: payment.id,
        date: day(payment.date),
        reference: payment.reference,
        source: payment.sourceType,
        sourceType: payment.sourceType,
        sourceUrl: payment.sourceUrl,
        method: payment.method,
        amount: money(payment.amount),
        appliedAmount: money(payment.appliedAmount),
        unappliedAmount: money(payment.unappliedAmount),
        status: payment.status,
        reversedAt: payment.reversedAt ? day(payment.reversedAt) : null,
        reversalAmount:
          payment.reversedAt && day(payment.reversedAt) <= period.today
            ? money(payment.amount.negated())
            : null,
        allocations: payment.allocations.map((allocation) => ({
          receivableId: allocation.receivableId,
          reference:
            account.movements.find(
              (movement) =>
                movement.receivableId === allocation.receivableId && movement.type === 'INVOICE',
            )?.reference ?? allocation.receivableId,
          amount: money(allocation.amount),
          dueDate: allocation.dueDate ? day(allocation.dueDate) : null,
        })),
      }));
    return {
      customer: {
        id: account.customer.id,
        name: account.customer.name,
        code: account.customer.customerCode,
        companyId: account.customer.companyId,
      },
      currency: data.currency,
      asOf: period.today,
      reliabilityAsOf: period.dateTo,
      access,
      performance: rows.find((row) => row.id === id)!,
      receiptBasis: rows.find((row) => row.id === id)!.receiptBasis,
      warnings:
        access.receipts && access.balances
          ? [...new Set([...data.warnings, ...account.warnings])]
          : [],
      period: { dateFrom: period.dateFrom, dateTo: period.dateTo },
      rows: history.slice(pagination.offset, pagination.offset + pagination.limit),
      total: history.length,
      page: pagination.page,
      limit: pagination.limit,
    };
  }
}
