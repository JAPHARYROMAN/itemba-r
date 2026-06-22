import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { auditFor, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { AccessLevel, PayableStatus, Prisma } from '@prisma/client';

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function currentYearStart() {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1);
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QuerySupplierDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      productCategoryId,
      supplierType,
      status,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (productCategoryId) {
      where.productCategories = { some: { productCategoryId } };
    }
    if (supplierType) where.supplierType = supplierType;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { supplierCode: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { tin: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          productCategories: {
            include: { productCategory: { select: { id: true, name: true, categoryType: true } } },
            orderBy: { productCategory: { name: 'asc' } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async workbenchSummary(query: QuerySupplierDto, user: AuthUser) {
    const {
      companyId,
      divisionId,
      branchId,
      productCategoryId,
      supplierType,
      status,
      search,
    } = query;

    const where: Prisma.SupplierWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (productCategoryId) {
      where.productCategories = { some: { productCategoryId } };
    }
    if (supplierType) where.supplierType = supplierType;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { supplierCode: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { tin: { contains: search, mode: 'insensitive' } },
      ];
    }

    const suppliers = await this.prisma.supplier.findMany({
      where,
      select: { id: true, status: true, currentBalance: true },
      take: 5000,
    });
    const supplierIds = suppliers.map((supplier) => supplier.id);
    const openStatuses: PayableStatus[] = [
      PayableStatus.OPEN,
      PayableStatus.PARTIALLY_PAID,
      PayableStatus.OVERDUE,
    ];
    const [openPayables, overduePayables] = supplierIds.length
      ? await Promise.all([
          this.prisma.payable.aggregate({
            where: {
              supplierId: { in: supplierIds },
              deletedAt: null,
              status: { in: openStatuses },
            },
            _sum: { outstandingAmount: true },
          }),
          this.prisma.payable.aggregate({
            where: {
              supplierId: { in: supplierIds },
              deletedAt: null,
              status: { in: openStatuses },
              dueDate: { lt: new Date() },
              outstandingAmount: { gt: 0 },
            },
            _sum: { outstandingAmount: true },
          }),
        ])
      : [{ _sum: { outstandingAmount: 0 } }, { _sum: { outstandingAmount: 0 } }];

    return {
      total: suppliers.length,
      active: suppliers.filter((supplier) => supplier.status === 'ACTIVE').length,
      blocked: suppliers.filter((supplier) => supplier.status === 'BLOCKED').length,
      inactive: suppliers.filter((supplier) => supplier.status === 'INACTIVE').length,
      currentBalance: suppliers.reduce(
        (sum, supplier) => sum + toNumber(supplier.currentBalance),
        0,
      ),
      openPayableBalance: toNumber(openPayables._sum.outstandingAmount),
      overduePayableBalance: toNumber(overduePayables._sum.outstandingAmount),
    };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: true,
        branch: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        updatedBy: { select: { id: true, fullName: true, email: true } },
        productCategories: {
          include: { productCategory: { select: { id: true, name: true, categoryType: true } } },
          orderBy: { productCategory: { name: 'asc' } },
        },
      },
    });
    if (!record) throw new NotFoundException('Supplier not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);

    {
      const meta = auditFor('Supplier', 'VIEW');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Supplier',
        entityId: record.id,
        userId: user.id,
        companyId: record.companyId,
        severity: meta.severity,
      });
    }

    return record;
  }

  async controlCenter(id: string, user: AuthUser) {
    const supplier = await this.findOne(id, user);
    const [purchaseSummary, payablesSummary, ledger, performance, statementRuns, productCoverage] =
      await Promise.all([
        this.purchaseSummary(id, user),
        this.payablesSummary(id, user),
        this.ledger(id, user),
        this.prisma.supplierPerformanceProfile.findFirst({
          where: { supplierId: id, companyId: supplier.companyId, deletedAt: null },
          include: { reviewedBy: { select: { id: true, fullName: true, email: true } } },
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.supplierStatementRun.findMany({
          where: { supplierId: id, companyId: supplier.companyId },
          include: { generatedBy: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.productCoverage(id, supplier.companyId),
      ]);

    return {
      supplier,
      summary: {
        lifetimePurchaseTotal: purchaseSummary.totals.lifetimePurchaseTotal,
        ytdPurchaseTotal: purchaseSummary.totals.ytdPurchaseTotal,
        receivedPurchaseTotal: purchaseSummary.totals.receivedPurchaseTotal,
        purchaseOrderCount: purchaseSummary.totals.purchaseOrderCount,
        openPayableBalance: payablesSummary.totals.openPayableBalance,
        overduePayableBalance: payablesSummary.totals.overduePayableBalance,
        paidPayableTotal: payablesSummary.totals.paidPayableTotal,
        payableCount: payablesSummary.totals.payableCount,
      },
      recentPurchaseOrders: purchaseSummary.recentPurchaseOrders,
      openPayables: payablesSummary.openPayables,
      recentPayables: payablesSummary.recentPayables,
      latestStatements: statementRuns,
      performance,
      productCoverage,
      ledger: ledger.events.slice(0, 12),
      audit: {
        createdAt: supplier.createdAt,
        updatedAt: supplier.updatedAt,
        createdBy: supplier.createdBy,
        updatedBy: supplier.updatedBy,
      },
    };
  }

  async ledger(id: string, user: AuthUser) {
    const supplier = await this.findOneScoped(id, user, AccessLevel.READ);
    const [purchaseOrders, payables] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: { supplierId: id, companyId: supplier.companyId, deletedAt: null },
        select: {
          id: true,
          purchaseOrderNumber: true,
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
      this.prisma.payable.findMany({
        where: { supplierId: id, companyId: supplier.companyId, deletedAt: null },
        select: {
          id: true,
          payableNumber: true,
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
      ...purchaseOrders.map((order) => ({
        id: `po-${order.id}`,
        type: 'PURCHASE_ORDER',
        sourceId: order.id,
        reference: order.purchaseOrderNumber,
        date: order.orderDate,
        status: order.status,
        paymentStatus: order.paymentStatus,
        debit: toNumber(order.totalAmount),
        credit: toNumber(order.paidAmount),
        balanceImpact: toNumber(order.outstandingAmount),
        currency: order.currency,
      })),
      ...payables.map((payable) => ({
        id: `ap-${payable.id}`,
        type: 'PAYABLE',
        sourceId: payable.id,
        reference: payable.payableNumber,
        date: payable.issueDate,
        dueDate: payable.dueDate,
        status: payable.status,
        debit: toNumber(payable.amount),
        credit: toNumber(payable.paidAmount),
        balanceImpact: toNumber(payable.outstandingAmount),
        currency: payable.currency,
        notes: payable.notes,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { supplierId: id, companyId: supplier.companyId, events };
  }

  async purchaseSummary(id: string, user: AuthUser) {
    const supplier = await this.findOneScoped(id, user, AccessLevel.READ);
    const ytdStart = currentYearStart();
    const where: Prisma.PurchaseOrderWhereInput = {
      supplierId: id,
      companyId: supplier.companyId,
      deletedAt: null,
    };
    const [all, ytd, received, count, recentPurchaseOrders] = await Promise.all([
      this.prisma.purchaseOrder.aggregate({ where, _sum: { totalAmount: true } }),
      this.prisma.purchaseOrder.aggregate({
        where: { ...where, orderDate: { gte: ytdStart } },
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: { ...where, status: 'RECEIVED' },
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
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
      supplierId: id,
      companyId: supplier.companyId,
      totals: {
        lifetimePurchaseTotal: toNumber(all._sum.totalAmount),
        ytdPurchaseTotal: toNumber(ytd._sum.totalAmount),
        receivedPurchaseTotal: toNumber(received._sum.totalAmount),
        purchaseOrderCount: count,
      },
      recentPurchaseOrders,
    };
  }

  async payablesSummary(id: string, user: AuthUser) {
    const supplier = await this.findOneScoped(id, user, AccessLevel.READ);
    const today = new Date();
    const where: Prisma.PayableWhereInput = {
      supplierId: id,
      companyId: supplier.companyId,
      deletedAt: null,
    };
    const openStatuses: PayableStatus[] = [
      PayableStatus.OPEN,
      PayableStatus.PARTIALLY_PAID,
      PayableStatus.OVERDUE,
    ];
    const [open, overdue, paid, count, openPayables, recentPayables] = await Promise.all([
      this.prisma.payable.aggregate({
        where: { ...where, status: { in: openStatuses } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.payable.aggregate({
        where: {
          ...where,
          status: { in: openStatuses },
          dueDate: { lt: today },
          outstandingAmount: { gt: 0 },
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.payable.aggregate({
        where,
        _sum: { paidAmount: true },
      }),
      this.prisma.payable.count({ where }),
      this.prisma.payable.findMany({
        where: { ...where, status: { in: openStatuses } },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          purchaseOrders: {
            where: { deletedAt: null },
            select: { id: true, purchaseOrderNumber: true, status: true, totalAmount: true },
            take: 5,
          },
        },
        orderBy: { issueDate: 'desc' },
        take: 10,
      }),
      this.prisma.payable.findMany({
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
      supplierId: id,
      companyId: supplier.companyId,
      totals: {
        openPayableBalance: toNumber(open._sum.outstandingAmount),
        overduePayableBalance: toNumber(overdue._sum.outstandingAmount),
        paidPayableTotal: toNumber(paid._sum.paidAmount),
        payableCount: count,
      },
      openPayables,
      recentPayables,
    };
  }

  async create(dto: CreateSupplierDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    if (dto.branchId) {
      throw new BadRequestException('Suppliers are scoped to a division, not a branch');
    }
    const productCategoryIds = Array.from(new Set(dto.productCategoryIds));
    await this.assertDivisionAndCategories(dto.companyId, dto.divisionId, productCategoryIds);

    const supplierCode =
      dto.supplierCode ?? `SUPP-${Date.now().toString(36).toUpperCase()}`;

    if (dto.supplierCode) {
      const existing = await this.prisma.supplier.findFirst({
        where: { supplierCode: dto.supplierCode, companyId: dto.companyId, deletedAt: null },
      });
      if (existing) {
        throw new BadRequestException(
          `Supplier code "${dto.supplierCode}" already exists for this company`,
        );
      }
    }

    const record = await this.prisma.supplier.create({
      data: {
        supplierCode,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: null,
        supplierType: dto.supplierType,
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
        productCategories: {
          create: productCategoryIds.map((productCategoryId) => ({ productCategoryId })),
        },
      },
      include: {
        productCategories: { include: { productCategory: true } },
      },
    });

    {
      const meta = auditFor('Supplier', 'CREATE');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Supplier',
        entityId: record.id,
        userId: user.id,
        companyId: record.companyId,
        newValue: record as any,
        severity: meta.severity,
      });
    }

    return record;
  }

  async update(id: string, dto: UpdateSupplierDto, user: AuthUser) {
    const existing = await this.findOneScoped(id, user, AccessLevel.WRITE);

    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Supplier companyId is immutable after creation');
    }
    if (dto.branchId) {
      throw new BadRequestException('Suppliers are scoped to a division, not a branch');
    }
    const divisionId = dto.divisionId ?? existing.divisionId;
    const productCategoryIds =
      dto.productCategoryIds !== undefined ? Array.from(new Set(dto.productCategoryIds)) : undefined;
    if (!divisionId) {
      throw new BadRequestException('Supplier division is required');
    }
    if (dto.divisionId !== undefined || dto.productCategoryIds !== undefined) {
      await this.assertDivisionAndCategories(
        existing.companyId,
        divisionId,
        productCategoryIds,
        dto.productCategoryIds !== undefined,
      );
    }

    const record = await this.prisma.$transaction(async (tx) => {
      if (dto.productCategoryIds !== undefined) {
        await tx.supplierProductCategory.deleteMany({ where: { supplierId: id } });
      }
      return tx.supplier.update({
        where: { id },
        data: {
          ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
          ...(dto.branchId !== undefined && { branchId: null }),
          ...(dto.supplierType !== undefined && { supplierType: dto.supplierType }),
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
          ...(dto.productCategoryIds !== undefined && {
            productCategories: {
              create: productCategoryIds!.map((productCategoryId) => ({ productCategoryId })),
            },
          }),
          updatedById: user.id,
        },
        include: { productCategories: { include: { productCategory: true } } },
      });
    });

    {
      const meta = auditFor('Supplier', 'UPDATE');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Supplier',
        entityId: id,
        userId: user.id,
        companyId: record.companyId,
        oldValue: existing as any,
        newValue: record as any,
        severity: meta.severity,
      });
    }

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOneScoped(id, user, AccessLevel.WRITE);

    await this.prisma.supplier.update({ where: { id }, data: { deletedAt: new Date() } });

    {
      const meta = auditFor('Supplier', 'DELETE');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Supplier',
        entityId: id,
        userId: user.id,
        companyId: existing.companyId,
        oldValue: existing as any,
        severity: meta.severity,
      });
    }

    return { success: true };
  }

  /** Internal scoped lookup for update/remove paths. */
  private async findOneScoped(id: string, user: AuthUser, minimum: AccessLevel) {
    const record = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Supplier not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  private async productCoverage(id: string, companyId: string) {
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        purchaseOrder: {
          supplierId: id,
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
      },
      orderBy: { createdAt: 'desc' },
      take: 250,
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
      if (!current) {
        byProduct.set(line.productId, {
          product: line.product,
          unit: line.unit,
          quantity,
          totalAmount,
          lastPurchasedAt: line.createdAt,
        });
      } else {
        current.quantity += quantity;
        current.totalAmount += totalAmount;
        if (line.createdAt > current.lastPurchasedAt) current.lastPurchasedAt = line.createdAt;
      }
    }

    return Array.from(byProduct.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 25);
  }

  private async assertDivisionAndCategories(
    companyId: string,
    divisionId: string,
    productCategoryIds: string[] | undefined,
    requireCategories = true,
  ) {
    const division = await this.prisma.division.findFirst({
      where: { id: divisionId, deletedAt: null },
      select: { companyId: true },
    });
    if (!division || division.companyId !== companyId) {
      throw new BadRequestException('Supplier division must belong to this company');
    }

    const uniqueCategoryIds = Array.from(new Set(productCategoryIds ?? []));
    if (requireCategories && uniqueCategoryIds.length === 0) {
      throw new BadRequestException('Supplier must be linked to at least one product category');
    }
    if (!uniqueCategoryIds.length) return;

    const categories = await this.prisma.productCategory.findMany({
      where: { id: { in: uniqueCategoryIds }, companyId, deletedAt: null },
      select: { id: true },
    });
    if (categories.length !== uniqueCategoryIds.length) {
      throw new BadRequestException('Supplier product categories must belong to this company');
    }
  }
}
