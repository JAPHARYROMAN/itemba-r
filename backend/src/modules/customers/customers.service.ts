import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { auditFor, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { AccessLevel, Prisma, ReceivableStatus } from '@prisma/client';

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function currentYearStart() {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1);
}

const OPEN_RECEIVABLE_STATUSES: ReceivableStatus[] = [
  ReceivableStatus.OPEN,
  ReceivableStatus.PARTIALLY_PAID,
  ReceivableStatus.OVERDUE,
];

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryCustomerDto, user: AuthUser) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where = await this.customerWhere(query, user);

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ name: 'asc' }, { customerCode: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async workbenchSummary(query: QueryCustomerDto, user: AuthUser) {
    const where = await this.customerWhere(query, user);
    const customers = await this.prisma.customer.findMany({
      where,
      select: { id: true, status: true, currentBalance: true, creditLimit: true },
      take: 5000,
    });
    const customerIds = customers.map((customer) => customer.id);
    const [openReceivables, overdueReceivables] = customerIds.length
      ? await Promise.all([
          this.prisma.receivable.aggregate({
            where: {
              customerId: { in: customerIds },
              deletedAt: null,
              status: { in: OPEN_RECEIVABLE_STATUSES },
            },
            _sum: { outstandingAmount: true },
          }),
          this.prisma.receivable.aggregate({
            where: {
              customerId: { in: customerIds },
              deletedAt: null,
              status: { in: OPEN_RECEIVABLE_STATUSES },
              dueDate: { lt: new Date() },
              outstandingAmount: { gt: 0 },
            },
            _sum: { outstandingAmount: true },
          }),
        ])
      : [{ _sum: { outstandingAmount: 0 } }, { _sum: { outstandingAmount: 0 } }];

    return {
      total: customers.length,
      active: customers.filter((customer) => customer.status === 'ACTIVE').length,
      blocked: customers.filter((customer) => customer.status === 'BLOCKED').length,
      inactive: customers.filter((customer) => customer.status === 'INACTIVE').length,
      creditLimit: customers.reduce((sum, customer) => sum + toNumber(customer.creditLimit), 0),
      currentBalance: customers.reduce(
        (sum, customer) => sum + toNumber(customer.currentBalance),
        0,
      ),
      openReceivableBalance: toNumber(openReceivables._sum.outstandingAmount),
      overdueReceivableBalance: toNumber(overdueReceivables._sum.outstandingAmount),
    };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            code: true,
            phone: true,
            email: true,
            website: true,
            logoUrl: true,
            group: {
              select: {
                name: true,
                code: true,
                address: true,
                phone: true,
                email: true,
                website: true,
              },
            },
            profile: {
              select: {
                registeredName: true,
                tradingName: true,
                brelaRegNumber: true,
                tin: true,
                vrn: true,
                registeredAddress: true,
                postalAddress: true,
              },
            },
          },
        },
        division: true,
        branch: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        updatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!record) throw new NotFoundException('Customer not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);

    const { action, severity } = auditFor('Customer', 'VIEW');
    await this.auditLogs.log({
      action,
      entityType: 'Customer',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      severity,
    });

    return record;
  }

  async controlCenter(id: string, user: AuthUser) {
    const customer = await this.findOne(id, user);
    const [salesSummary, receivablesSummary, ledger, productHistory, statements, priceAgreements] =
      await Promise.all([
        this.salesSummary(id, user),
        this.receivablesSummary(id, user),
        this.ledger(id, user),
        this.productHistory(id, user),
        this.prisma.customerStatementRun.findMany({
          where: { customerId: id, companyId: customer.companyId },
          include: { generatedBy: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.prisma.customerPriceAgreement.findMany({
          where: { customerId: id, companyId: customer.companyId, deletedAt: null },
          include: {
            priceList: { select: { id: true, name: true, priceListType: true, status: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      ]);

    const creditLimit = toNumber(customer.creditLimit);
    const currentBalance = receivablesSummary.totals.openReceivableBalance;
    return {
      customer,
      summary: {
        lifetimeSalesTotal: salesSummary.totals.lifetimeSalesTotal,
        ytdSalesTotal: salesSummary.totals.ytdSalesTotal,
        paidSalesTotal: salesSummary.totals.paidSalesTotal,
        salesOrderCount: salesSummary.totals.salesOrderCount,
        openReceivableBalance: receivablesSummary.totals.openReceivableBalance,
        overdueReceivableBalance: receivablesSummary.totals.overdueReceivableBalance,
        paidReceivableTotal: receivablesSummary.totals.paidReceivableTotal,
        receivableCount: receivablesSummary.totals.receivableCount,
        creditLimit,
        creditAvailable: Math.max(0, creditLimit - currentBalance),
        creditUtilizationPct:
          creditLimit > 0 ? Math.min(100, (currentBalance / creditLimit) * 100) : 0,
      },
      recentSalesOrders: salesSummary.recentSalesOrders,
      openReceivables: receivablesSummary.openReceivables,
      recentReceivables: receivablesSummary.recentReceivables,
      latestStatements: statements,
      priceAgreements,
      productHistory,
      ledger: ledger.events.slice(0, 12),
      audit: {
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
        createdBy: customer.createdBy,
        updatedBy: customer.updatedBy,
      },
    };
  }

  async ledger(id: string, user: AuthUser) {
    const customer = await this.findOneScoped(id, user, AccessLevel.READ);
    const [salesOrders, receivables] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: { customerId: id, companyId: customer.companyId, deletedAt: null },
        select: {
          id: true,
          salesOrderNumber: true,
          orderDate: true,
          status: true,
          paymentStatus: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
          currency: true,
        },
        orderBy: { orderDate: 'desc' },
        take: 50,
      }),
      this.prisma.receivable.findMany({
        where: { customerId: id, companyId: customer.companyId, deletedAt: null },
        select: {
          id: true,
          receivableNumber: true,
          issueDate: true,
          dueDate: true,
          status: true,
          amount: true,
          paidAmount: true,
          outstandingAmount: true,
          currency: true,
          sourceType: true,
          sourceId: true,
          notes: true,
        },
        orderBy: { issueDate: 'desc' },
        take: 50,
      }),
    ]);

    const events = [
      ...salesOrders.map((order) => ({
        id: `so-${order.id}`,
        type: 'SALES_ORDER',
        sourceId: order.id,
        reference: order.salesOrderNumber,
        date: order.orderDate,
        status: order.status,
        paymentStatus: order.paymentStatus,
        debit: toNumber(order.totalAmount),
        credit: toNumber(order.paidAmount),
        balanceImpact: toNumber(order.outstandingAmount),
        currency: order.currency,
      })),
      ...receivables.map((receivable) => ({
        id: `ar-${receivable.id}`,
        type: 'RECEIVABLE',
        sourceId: receivable.id,
        reference: receivable.receivableNumber,
        date: receivable.issueDate,
        dueDate: receivable.dueDate,
        status: receivable.status,
        debit: toNumber(receivable.amount),
        credit: toNumber(receivable.paidAmount),
        balanceImpact: toNumber(receivable.outstandingAmount),
        currency: receivable.currency,
        notes: receivable.notes,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { customerId: id, companyId: customer.companyId, events };
  }

  async salesSummary(id: string, user: AuthUser) {
    const customer = await this.findOneScoped(id, user, AccessLevel.READ);
    const ytdStart = currentYearStart();
    const where: Prisma.SalesOrderWhereInput = {
      customerId: id,
      companyId: customer.companyId,
      deletedAt: null,
    };
    const [all, ytd, paid, count, recentSalesOrders] = await Promise.all([
      this.prisma.salesOrder.aggregate({ where, _sum: { totalAmount: true } }),
      this.prisma.salesOrder.aggregate({
        where: { ...where, orderDate: { gte: ytdStart } },
        _sum: { totalAmount: true },
      }),
      this.prisma.salesOrder.aggregate({
        where: { ...where, paymentStatus: 'PAID' },
        _sum: { totalAmount: true },
      }),
      this.prisma.salesOrder.count({ where }),
      this.prisma.salesOrder.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          salesperson: { select: { id: true, fullName: true, employeeCode: true } },
          lines: {
            include: {
              product: {
                select: {
                  id: true,
                  productCode: true,
                  sku: true,
                  name: true,
                  category: { select: { id: true, name: true, categoryType: true } },
                },
              },
              unit: { select: { id: true, name: true, symbol: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { orderDate: 'desc' },
        take: 10,
      }),
    ]);

    return {
      customerId: id,
      companyId: customer.companyId,
      totals: {
        lifetimeSalesTotal: toNumber(all._sum.totalAmount),
        ytdSalesTotal: toNumber(ytd._sum.totalAmount),
        paidSalesTotal: toNumber(paid._sum.totalAmount),
        salesOrderCount: count,
      },
      recentSalesOrders,
    };
  }

  async receivablesSummary(id: string, user: AuthUser) {
    const customer = await this.findOneScoped(id, user, AccessLevel.READ);
    const today = new Date();
    const where: Prisma.ReceivableWhereInput = {
      customerId: id,
      companyId: customer.companyId,
      deletedAt: null,
    };
    const [open, overdue, paid, count, openReceivables, recentReceivables] = await Promise.all([
      this.prisma.receivable.aggregate({
        where: { ...where, status: { in: OPEN_RECEIVABLE_STATUSES } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: {
          ...where,
          status: { in: OPEN_RECEIVABLE_STATUSES },
          dueDate: { lt: today },
          outstandingAmount: { gt: 0 },
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({ where, _sum: { paidAmount: true } }),
      this.prisma.receivable.count({ where }),
      this.prisma.receivable.findMany({
        where: { ...where, status: { in: OPEN_RECEIVABLE_STATUSES } },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          salesOrders: {
            where: { deletedAt: null },
            select: { id: true, salesOrderNumber: true, status: true, totalAmount: true },
            take: 5,
          },
        },
        orderBy: { issueDate: 'desc' },
        take: 10,
      }),
      this.prisma.receivable.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
        },
        orderBy: { issueDate: 'desc' },
        take: 10,
      }),
    ]);

    return {
      customerId: id,
      companyId: customer.companyId,
      totals: {
        openReceivableBalance: toNumber(open._sum.outstandingAmount),
        overdueReceivableBalance: toNumber(overdue._sum.outstandingAmount),
        paidReceivableTotal: toNumber(paid._sum.paidAmount),
        receivableCount: count,
      },
      openReceivables,
      recentReceivables,
    };
  }

  async productHistory(id: string, user: AuthUser) {
    const customer = await this.findOneScoped(id, user, AccessLevel.READ);
    return this.productHistoryForCustomer(id, customer.companyId);
  }

  async create(dto: CreateCustomerDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const branch = await this.assertBranchBelongsToCompany(
      dto.companyId,
      dto.branchId,
      dto.divisionId,
    );

    const customerCode = dto.customerCode ?? `CUST-${Date.now().toString(36).toUpperCase()}`;

    if (dto.customerCode) {
      const existing = await this.prisma.customer.findFirst({
        where: { customerCode: dto.customerCode, companyId: dto.companyId, deletedAt: null },
      });
      if (existing) {
        throw new BadRequestException(
          `Customer code "${dto.customerCode}" already exists for this company`,
        );
      }
    }

    const record = await this.prisma.customer.create({
      data: {
        customerCode,
        companyId: dto.companyId,
        divisionId: branch.divisionId,
        branchId: dto.branchId,
        customerType: dto.customerType,
        name: dto.name,
        legalName: dto.legalName,
        tin: dto.tin,
        vrn: dto.vrn,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        contactPerson: dto.contactPerson,
        creditLimit: dto.creditLimit ?? 0,
        paymentTerms: dto.paymentTerms,
        status: dto.status ?? 'ACTIVE',
        notes: dto.notes,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const { action, severity } = auditFor('Customer', 'CREATE');
    await this.auditLogs.log({
      action,
      entityType: 'Customer',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
      severity,
    });

    return record;
  }

  async update(id: string, dto: UpdateCustomerDto, user: AuthUser) {
    const existing = await this.findOneScoped(id, user, AccessLevel.WRITE);

    // Reject any attempt to move the customer to a different company. The
    // companyId is established at create time and is part of the row's
    // identity for accounting purposes.
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Customer companyId is immutable after creation');
    }
    if (dto.divisionId !== undefined && dto.branchId === undefined) {
      throw new BadRequestException('Customer division is derived from the selected branch');
    }
    const branch = dto.branchId
      ? await this.assertBranchBelongsToCompany(existing.companyId, dto.branchId, dto.divisionId)
      : undefined;

    const record = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(branch && { divisionId: branch.divisionId, branchId: branch.id }),
        ...(dto.customerType !== undefined && { customerType: dto.customerType }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.legalName !== undefined && { legalName: dto.legalName }),
        ...(dto.tin !== undefined && { tin: dto.tin }),
        ...(dto.vrn !== undefined && { vrn: dto.vrn }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.contactPerson !== undefined && { contactPerson: dto.contactPerson }),
        ...(dto.creditLimit !== undefined && { creditLimit: dto.creditLimit }),
        ...(dto.paymentTerms !== undefined && { paymentTerms: dto.paymentTerms }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedById: user.id,
      },
    });

    const { action, severity } = auditFor('Customer', 'UPDATE');
    await this.auditLogs.log({
      action,
      entityType: 'Customer',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
      severity,
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOneScoped(id, user, AccessLevel.WRITE);

    await this.prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });

    const { action, severity } = auditFor('Customer', 'DELETE');
    await this.auditLogs.log({
      action,
      entityType: 'Customer',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
      severity,
    });

    return { success: true };
  }

  /**
   * Customer 360° — aggregate everything a counter clerk or sales manager
   * needs at a glance: credit posture, recent orders, top SKUs, payment
   * history, preferred salesperson. Single round-trip, single screen.
   */
  async profile(id: string, user: AuthUser) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            code: true,
            phone: true,
            email: true,
            website: true,
            logoUrl: true,
            group: {
              select: {
                name: true,
                code: true,
                address: true,
                phone: true,
                email: true,
                website: true,
              },
            },
            profile: {
              select: {
                registeredName: true,
                tradingName: true,
                brelaRegNumber: true,
                tin: true,
                vrn: true,
                registeredAddress: true,
                postalAddress: true,
              },
            },
          },
        },
        branch: { select: { id: true, name: true, code: true, address: true, phone: true } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    await this.companyScope.assertCanAccessCompany(user, customer.companyId);

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000);

    const [
      receivableSummary,
      overdueSummary,
      recentOrders,
      topProductsRaw,
      recentPayments,
      salespersonGroups,
      lifetimeAgg,
    ] = await Promise.all([
      // Outstanding exposure across all active receivables.
      this.prisma.receivable.aggregate({
        where: {
          companyId: customer.companyId,
          customerId: id,
          status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as any },
          deletedAt: null,
        },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
      // Overdue subset.
      this.prisma.receivable.aggregate({
        where: {
          companyId: customer.companyId,
          customerId: id,
          status: 'OVERDUE' as any,
          deletedAt: null,
        },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
      // Last 10 orders.
      this.prisma.salesOrder.findMany({
        where: { companyId: customer.companyId, customerId: id, deletedAt: null },
        orderBy: { orderDate: 'desc' },
        take: 10,
        select: {
          id: true,
          salesOrderNumber: true,
          orderDate: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
          status: true,
          paymentStatus: true,
          paymentMethod: true,
          salesperson: { select: { id: true, fullName: true, employeeCode: true } },
        },
      }),
      // Top 5 SKUs over the last 90 days, by line total.
      this.prisma.salesOrderLine.groupBy({
        by: ['productId'],
        where: {
          salesOrder: {
            companyId: customer.companyId,
            customerId: id,
            orderDate: { gte: ninetyDaysAgo },
            deletedAt: null,
          },
        },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 5,
      }),
      // Last 10 receivable settlements (paid receivables).
      this.prisma.receivable.findMany({
        where: { companyId: customer.companyId, customerId: id, status: 'PAID', deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          receivableNumber: true,
          amount: true,
          paidAmount: true,
          updatedAt: true,
        },
      }),
      // Salesperson frequency over the last 90 days.
      this.prisma.salesOrder.groupBy({
        by: ['salespersonId'],
        where: {
          companyId: customer.companyId,
          customerId: id,
          orderDate: { gte: ninetyDaysAgo },
          deletedAt: null,
          salespersonId: { not: null },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 1,
      }),
      // Lifetime totals (count + total).
      this.prisma.salesOrder.aggregate({
        where: { companyId: customer.companyId, customerId: id, deletedAt: null },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
    ]);

    // Resolve product names for the top SKUs (groupBy doesn't include relations).
    const topProductIds = topProductsRaw.map((p) => p.productId);
    const productMeta =
      topProductIds.length > 0
        ? await this.prisma.product.findMany({
            where: { id: { in: topProductIds } },
            select: { id: true, name: true, sku: true },
          })
        : [];
    const productById = new Map(productMeta.map((p) => [p.id, p]));
    const topProducts = topProductsRaw.map((p) => ({
      productId: p.productId,
      productName: productById.get(p.productId)?.name ?? 'Unknown',
      sku: productById.get(p.productId)?.sku ?? null,
      totalQuantity: Number(p._sum.quantity ?? 0),
      totalSpend: Number(p._sum.lineTotal ?? 0),
    }));

    // Resolve preferred-salesperson name.
    const preferredSalespersonId = salespersonGroups[0]?.salespersonId ?? null;
    const preferredSalesperson = preferredSalespersonId
      ? await this.prisma.employee.findUnique({
          where: { id: preferredSalespersonId },
          select: { id: true, fullName: true, employeeCode: true },
        })
      : null;

    const totalReceivable = Number(receivableSummary._sum.outstandingAmount ?? 0);
    const overdueAmount = Number(overdueSummary._sum.outstandingAmount ?? 0);
    const creditLimit = Number(customer.creditLimit ?? 0);
    const creditAvailable = Math.max(0, creditLimit - totalReceivable);
    const creditUtilizationPct =
      creditLimit > 0 ? Math.min(100, (totalReceivable / creditLimit) * 100) : 0;

    return {
      customer,
      credit: {
        creditLimit,
        currentBalance: totalReceivable,
        totalReceivable,
        overdueAmount,
        overdueCount: overdueSummary._count.id,
        openReceivables: receivableSummary._count.id,
        creditAvailable,
        creditUtilizationPct,
      },
      lifetime: {
        ordersCount: lifetimeAgg._count.id,
        totalSpend: Number(lifetimeAgg._sum.totalAmount ?? 0),
      },
      recentOrders,
      topProducts,
      recentPayments,
      preferredSalesperson,
    };
  }

  /**
   * Internal lookup that asserts company access at the supplied minimum
   * level. Used by update/remove paths.
   */
  private async findOneScoped(id: string, user: AuthUser, minimum: AccessLevel) {
    const record = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Customer not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  private async customerWhere(query: QueryCustomerDto, user: AuthUser) {
    const {
      companyId,
      divisionId,
      branchId,
      customerType,
      status,
      search,
    } = query;
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (customerType) where.customerType = customerType;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { customerCode: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { tin: { contains: search, mode: 'insensitive' } },
        { vrn: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private async productHistoryForCustomer(id: string, companyId: string) {
    const lines = await this.prisma.salesOrderLine.findMany({
      where: {
        salesOrder: {
          customerId: id,
          companyId,
          deletedAt: null,
        },
      },
      include: {
        product: {
          select: {
            id: true,
            productCode: true,
            sku: true,
            name: true,
            category: { select: { id: true, name: true, categoryType: true } },
          },
        },
        unit: { select: { id: true, name: true, symbol: true } },
        salesOrder: { select: { orderDate: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const byProduct = new Map<
      string,
      {
        product: (typeof lines)[number]['product'];
        unit: (typeof lines)[number]['unit'];
        quantity: number;
        totalAmount: number;
        lastPurchasedAt: Date;
      }
    >();

    for (const line of lines) {
      const current = byProduct.get(line.productId);
      const quantity = toNumber(line.quantity);
      const totalAmount = toNumber(line.lineTotal);
      const purchasedAt = line.salesOrder.orderDate;
      if (!current) {
        byProduct.set(line.productId, {
          product: line.product,
          unit: line.unit,
          quantity,
          totalAmount,
          lastPurchasedAt: purchasedAt,
        });
      } else {
        current.quantity += quantity;
        current.totalAmount += totalAmount;
        if (purchasedAt > current.lastPurchasedAt) current.lastPurchasedAt = purchasedAt;
      }
    }

    return Array.from(byProduct.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 50);
  }

  private async assertBranchBelongsToCompany(
    companyId: string,
    branchId: string,
    divisionId?: string,
  ) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, deletedAt: null },
      select: { id: true, divisionId: true, division: { select: { companyId: true } } },
    });
    if (!branch || branch.division.companyId !== companyId) {
      throw new BadRequestException('Customer branch must belong to this company');
    }
    if (divisionId && branch.divisionId !== divisionId) {
      throw new BadRequestException('Customer branch must belong to the selected division');
    }
    return branch;
  }
}
