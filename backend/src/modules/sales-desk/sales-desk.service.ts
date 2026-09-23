import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CashDeskService } from '../cash-desk/cash-desk.service';
import { cashDate, payloadKey } from '../cash-desk/cash-desk.domain';
import {
  deskBalance,
  deskKey,
  positiveAmount,
  todayUtc,
} from '../invoice-desk/invoice-desk.domain';
import {
  SalesCreateDto,
  SalesCustomerDto,
  SalesPaymentDto,
  SalesQuery,
  SalesVoidDto,
} from './sales-desk.dto';
import { salesLines } from './sales-desk.domain';
const names = {
  company: { select: { name: true } },
  division: { select: { name: true } },
  branch: { select: { name: true } },
  customer: { select: { name: true, email: true, phone: true } },
} as const;
@Injectable()
export class SalesDeskService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly audit: AuditLogsService,
    private readonly cash: CashDeskService,
  ) {}
  directory(user: AuthUser) {
    return this.cash.directory(user);
  }
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.db.$transaction(work, { timeout: 20000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(e.code))
        throw new ConflictException(
          'This record already exists or changed. Refresh before trying again.',
        );
      throw e;
    }
  }
  private async where(
    user: AuthUser,
    q: SalesQuery = { page: 1 },
  ): Promise<Prisma.SalesDeskSaleWhereInput> {
    if (q.from && q.to && q.from > q.to)
      throw new BadRequestException('Start date must be on or before end date.');
    const open = { voidedAt: null, paidAmount: { lt: this.db.salesDeskSale.fields.totalAmount } };
    const statuses: Record<string, Prisma.SalesDeskSaleWhereInput> = {
      unpaid: { voidedAt: null, paidAmount: 0 },
      partial: { AND: [open, { paidAmount: { gt: 0 } }] },
      paid: { voidedAt: null, paidAmount: { equals: this.db.salesDeskSale.fields.totalAmount } },
      overdue: { ...open, dueDate: { lt: todayUtc() } },
      void: { voidedAt: { not: null } },
    };
    return {
      AND: [
        await this.companies.companyWhereFor(user, q.companyId),
        await this.org.recordWhereFor(user),
        {
          divisionId: q.divisionId,
          branchId: q.branchId,
          customerId: q.customerId,
          saleDate: {
            gte: q.from ? new Date(q.from) : undefined,
            lte: q.to ? new Date(q.to) : undefined,
          },
        },
        statuses[q.status ?? ''] ?? {},
        q.search?.trim()
          ? {
              OR: [
                { saleNumber: { contains: q.search.trim(), mode: 'insensitive' } },
                { customer: { name: { contains: q.search.trim(), mode: 'insensitive' } } },
                {
                  lines: {
                    some: { description: { contains: q.search.trim(), mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {},
      ],
    };
  }
  async customers(user: AuthUser, q: SalesQuery) {
    return this.db.salesDeskCustomer.findMany({
      where: {
        AND: [
          await this.companies.companyWhereFor(user, q.companyId),
          q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {},
        ],
      },
      include: { company: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
  }
  async createCustomer(user: AuthUser, d: SalesCustomerDto) {
    await this.companies.assertCanAccessCompany(user, d.companyId, AccessLevel.WRITE);
    if (!d.name.trim()) throw new BadRequestException('Enter a customer name.');
    return this.transaction(async (tx) => {
      const row = await tx.salesDeskCustomer.create({
        data: { ...d, name: d.name.trim(), nameKey: deskKey(d.name) },
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'SALES_DESK_CUSTOMER_CREATED',
        entityType: 'SalesDeskCustomer',
        entityId: row.id,
        companyId: row.companyId,
        userId: user.id,
        newValue: { name: row.name },
      });
      return row;
    });
  }
  private async event(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    sale: { id: string; companyId: string },
    action: string,
    detail: string,
  ) {
    await tx.salesDeskEvent.create({
      data: {
        saleId: sale.id,
        actorId: user.id,
        actorName: user.fullName || user.email,
        action,
        detail,
      },
    });
    await this.audit.logStrictInTransaction(tx, {
      action: `SALES_DESK_${action}`,
      entityType: 'SalesDeskSale',
      entityId: sale.id,
      companyId: sale.companyId,
      userId: user.id,
      metadata: { detail },
    });
  }
  async create(user: AuthUser, d: SalesCreateDto) {
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
    const customer = await this.db.salesDeskCustomer.findFirst({
      where: { id: d.customerId, companyId: d.companyId },
    });
    if (!branch || !customer)
      throw new BadRequestException('Choose a customer and branch belonging to this company.');
    const saleDate = cashDate(d.saleDate),
      dueDate = new Date(d.dueDate);
    if (dueDate < saleDate) throw new BadRequestException('Due date cannot precede the sale date.');
    const calculated = salesLines(d.lines),
      key = payloadKey(d);
    return this.transaction(async (tx) => {
      const existing = await tx.salesDeskSale.findUnique({ where: { requestId: d.requestId } });
      if (existing) {
        if (existing.payloadKey !== key || existing.createdBy !== user.id)
          throw new ConflictException('This sale request reference was already used.');
        return existing;
      }
      const saleNumber = `S-${d.saleDate.replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const row = await tx.salesDeskSale.create({
        data: {
          requestId: d.requestId,
          payloadKey: key,
          companyId: d.companyId,
          divisionId: d.divisionId,
          branchId: d.branchId,
          customerId: d.customerId,
          saleNumber,
          numberKey: saleNumber,
          currency: d.currency,
          saleDate,
          dueDate,
          totalAmount: calculated.totalAmount,
          notes: d.notes?.trim(),
          createdBy: user.id,
          lines: { create: calculated.lines },
        },
      });
      await this.event(
        tx,
        user,
        row,
        'CREATED',
        `${saleNumber} · ${d.currency} ${row.totalAmount.toFixed(2)}`,
      );
      return row;
    });
  }
  async list(user: AuthUser, q: SalesQuery) {
    const where = await this.where(user, q);
    const [rows, total] = await this.db.$transaction(
      [
        this.db.salesDeskSale.findMany({
          where,
          include: names,
          orderBy: [{ saleDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: 25,
          skip: ((q.page || 1) - 1) * 25,
        }),
        this.db.salesDeskSale.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      rows: rows.map((r) => ({ ...r, ...deskBalance(r) })),
      total,
      page: q.page || 1,
      pageSize: 25,
    };
  }
  async overview(user: AuthUser, q: SalesQuery) {
    const rows = await this.db.salesDeskSale.findMany({
      where: {
        AND: [
          await this.where(user, {
            ...q,
            companyId: q.companyId,
            divisionId: q.divisionId,
            branchId: q.branchId,
            page: 1,
          }),
          { voidedAt: null },
        ],
      },
      select: {
        customerId: true,
        customer: { select: { name: true } },
        currency: true,
        totalAmount: true,
        paidAmount: true,
        dueDate: true,
      },
    });
    const currencies = new Map<
        string,
        {
          currency: string;
          total: Prisma.Decimal;
          paid: Prisma.Decimal;
          outstanding: Prisma.Decimal;
          overdue: Prisma.Decimal;
          count: number;
        }
      >(),
      customers = new Map<
        string,
        { id: string; name: string; currency: string; outstanding: Prisma.Decimal; count: number }
      >();
    for (const r of rows) {
      const balance = r.totalAmount.minus(r.paidAmount),
        c = currencies.get(r.currency) ?? {
          currency: r.currency,
          total: new Prisma.Decimal(0),
          paid: new Prisma.Decimal(0),
          outstanding: new Prisma.Decimal(0),
          overdue: new Prisma.Decimal(0),
          count: 0,
        };
      c.total = c.total.plus(r.totalAmount);
      c.paid = c.paid.plus(r.paidAmount);
      c.outstanding = c.outstanding.plus(balance);
      if (r.dueDate < todayUtc()) c.overdue = c.overdue.plus(balance);
      c.count++;
      currencies.set(r.currency, c);
      if (balance.gt(0)) {
        const key = `${r.customerId}:${r.currency}`,
          customer = customers.get(key) ?? {
            id: r.customerId,
            name: r.customer.name,
            currency: r.currency,
            outstanding: new Prisma.Decimal(0),
            count: 0,
          };
        customer.outstanding = customer.outstanding.plus(balance);
        customer.count++;
        customers.set(key, customer);
      }
    }
    return {
      currencies: [...currencies.values()],
      customers: [...customers.values()].sort(
        (a, b) => a.currency.localeCompare(b.currency) || b.outstanding.comparedTo(a.outstanding),
      ),
    };
  }
  async detail(user: AuthUser, id: string) {
    const row = await this.db.salesDeskSale.findFirst({
      where: { AND: [{ id }, await this.where(user)] },
      include: {
        ...names,
        lines: { orderBy: { position: 'asc' } },
        payments: {
          orderBy: { createdAt: 'desc' },
          include: {
            cashMovement: {
              select: { id: true },
            },
          },
        },
        events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
      },
    });
    if (!row) throw new NotFoundException('Sale not found.');
    return { ...row, ...deskBalance(row) };
  }
  private async writable(user: AuthUser, id: string) {
    const row = await this.detail(user, id);
    await this.companies.assertCanAccessCompany(user, row.companyId, AccessLevel.WRITE);
    await this.org.assertCanAccessScope(user, row.divisionId, row.branchId, AccessLevel.WRITE);
    return row;
  }
  async payment(user: AuthUser, id: string, d: SalesPaymentDto) {
    const sale = await this.writable(user, id),
      amount = positiveAmount(d.amount),
      date = cashDate(d.paymentDate);
    if (date < sale.saleDate)
      throw new BadRequestException('Payment date cannot precede the sale.');
    return this.transaction(async (tx) => {
      const key = payloadKey({ id, ...d }),
        existing = await tx.salesDeskPayment.findUnique({ where: { requestId: d.requestId } });
      if (existing) {
        if (existing.payloadKey !== key || existing.createdBy !== user.id)
          throw new ConflictException('This payment request reference was already used.');
        return existing;
      }
      const changed = await tx.salesDeskSale.updateMany({
        where: { id, version: d.version, voidedAt: null },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new ConflictException('This sale changed. Refresh before recording payment.');
      const latest = await tx.salesDeskSale.findUniqueOrThrow({ where: { id } });
      if (amount.gt(latest.totalAmount.minus(latest.paidAmount)))
        throw new BadRequestException('Payment exceeds the outstanding balance.');
      const payment = await tx.salesDeskPayment.create({
        data: {
          saleId: id,
          requestId: d.requestId,
          payloadKey: key,
          amount,
          paymentDate: date,
          reference: d.reference.trim(),
          createdBy: user.id,
        },
      });
      await this.cash.receiveSalesPayment(tx, user, sale, payment, d.accountId);
      await tx.salesDeskSale.update({ where: { id }, data: { paidAmount: { increment: amount } } });
      await this.event(
        tx,
        user,
        sale,
        'PAYMENT_RECORDED',
        `${sale.currency} ${amount.toFixed(2)} received into Cash Desk · ${d.reference || 'No reference'}`,
      );
      return payment;
    });
  }
  async void(user: AuthUser, id: string, d: SalesVoidDto) {
    await this.writable(user, id);
    if (d.reason.trim().length < 3) throw new BadRequestException('Enter a reason.');
    return this.transaction(async (tx) => {
      const changed = await tx.salesDeskSale.updateMany({
        where: { id, version: d.version, voidedAt: null, paidAmount: 0 },
        data: { version: { increment: 1 }, voidedAt: new Date() },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'Refresh the sale and reverse any payments in Cash Desk before voiding.',
        );
      const sale = await tx.salesDeskSale.findUniqueOrThrow({ where: { id } });
      await this.event(tx, user, sale, 'VOIDED', d.reason.trim());
      return { success: true };
    });
  }
}
