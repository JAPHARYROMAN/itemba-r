import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { auditFor, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { AccessLevel } from '@prisma/client';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryCustomerDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      customerType,
      status,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
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
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: true,
        branch: true,
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

  async create(dto: CreateCustomerDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    const customerCode =
      dto.customerCode ?? `CUST-${Date.now().toString(36).toUpperCase()}`;

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
        divisionId: dto.divisionId,
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

    const record = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
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
        company: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true } },
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
      // Outstanding (open + overdue, all-time).
      this.prisma.receivable.aggregate({
        where: { companyId: customer.companyId, customerId: id, status: { in: ['OPEN', 'OVERDUE'] as any }, deletedAt: null },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
      // Overdue subset.
      this.prisma.receivable.aggregate({
        where: { companyId: customer.companyId, customerId: id, status: 'OVERDUE' as any, deletedAt: null },
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
      // Last 10 receivable settlements (closed receivables — proxy for "paid").
      this.prisma.receivable.findMany({
        where: { companyId: customer.companyId, customerId: id, status: 'CLOSED' as any, deletedAt: null },
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
    const productMeta = topProductIds.length > 0
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
    const creditUtilizationPct = creditLimit > 0 ? Math.min(100, (totalReceivable / creditLimit) * 100) : 0;

    return {
      customer,
      credit: {
        creditLimit,
        currentBalance: Number(customer.currentBalance ?? 0),
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
}
