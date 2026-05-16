import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { TaxAutoApplyService } from '../tax-auto-apply/tax-auto-apply.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateSalesOrderDto, SalesOrderLineDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { QuerySalesOrderDto } from './dto/query-sales-order.dto';
import { AccessLevel, AuditSeverity, CurrencyCode } from '@prisma/client';

type SalesOrderReferenceIds = {
  divisionId?: string | null;
  branchId?: string | null;
  customerId?: string | null;
  salespersonId?: string | null;
  cashAccountId?: string | null;
  lines?: SalesOrderLineDto[];
};

function calculateLineTotals(
  lines: {
    productId: string;
    description?: string;
    quantity: number;
    unitId: string;
    unitPrice: number;
    discountAmount?: number;
    taxAmount?: number;
    inventoryLocationId?: string;
    batchId?: string;
  }[],
) {
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;

  const computed = lines.map((line) => {
    const qty = Number(line.quantity);
    const price = Number(line.unitPrice);
    const discount = Number(line.discountAmount ?? 0);
    const tax = Number(line.taxAmount ?? 0);
    const lineTotal = qty * price - discount + tax;
    subtotal += qty * price;
    totalDiscount += discount;
    totalTax += tax;
    return { ...line, lineTotal };
  });

  const totalAmount = subtotal - totalDiscount + totalTax;
  return { computed, subtotal, totalDiscount, totalTax, totalAmount };
}

@Injectable()
export class SalesOrdersService {
  private readonly logger = new Logger(SalesOrdersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly taxAutoApply: TaxAutoApplyService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QuerySalesOrderDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      customerId,
      salesType,
      status,
      paymentStatus,
      dateFrom,
      dateTo,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (salesType) where.salesType = salesType;
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (dateFrom || dateTo) {
      where.orderDate = {};
      if (dateFrom) where.orderDate.gte = new Date(dateFrom);
      if (dateTo) where.orderDate.lte = new Date(dateTo);
    }
    if (search) {
      where.OR = [
        { salesOrderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          customer: { select: { id: true, name: true } },
          lines: {
            include: {
              product: { select: { id: true, name: true } },
              unit: { select: { id: true, name: true, symbol: true } },
            },
          },
        },
        orderBy: { orderDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.salesOrder.findFirst({
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
            group: { select: { name: true, code: true, address: true, phone: true, email: true, website: true } },
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
        customer: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        confirmedBy: { select: { id: true, fullName: true } },
        cashAccount: { select: { id: true, accountName: true, accountType: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            unit: { select: { id: true, name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Sales order not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }
    return record;
  }

  async create(dto: CreateSalesOrderDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(dto.companyId, dto);
    const userId = user.id;
    const { computed, subtotal, totalDiscount, totalTax, totalAmount } = calculateLineTotals(
      dto.lines,
    );

    const record = await this.prisma.$transaction(async (tx) => {
      const salesOrderNumber = await this.codes.next({
        entityType: 'SalesOrder',
        companyId: dto.companyId,
        tx,
      });
      const order = await tx.salesOrder.create({
        data: {
          salesOrderNumber,
          companyId: dto.companyId,
          divisionId: dto.divisionId,
          branchId: dto.branchId,
          customerId: dto.customerId,
          customerName: dto.customerName,
          salesType: dto.salesType,
          orderDate: new Date(dto.orderDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          currency: dto.currency as CurrencyCode,
          subtotal,
          discountAmount: totalDiscount,
          taxAmount: totalTax,
          totalAmount,
          paidAmount: 0,
          outstandingAmount: totalAmount,
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          notes: dto.notes,
          salespersonId: dto.salespersonId,
          paymentMethod: dto.paymentMethod ?? 'CREDIT',
          cashAccountId: dto.cashAccountId,
          paymentReference: dto.paymentReference,
          createdById: userId,
        },
      });

      await tx.salesOrderLine.createMany({
        data: computed.map((line) => ({
          salesOrderId: order.id,
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unitId: line.unitId,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount ?? 0,
          taxAmount: line.taxAmount ?? 0,
          lineTotal: line.lineTotal,
          inventoryLocationId: line.inventoryLocationId,
          batchId: line.batchId,
        })),
      });

      return order;
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_CREATE',
      entityType: 'SalesOrder',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return this.findOne(record.id, user);
  }

  async update(id: string, dto: UpdateSalesOrderDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Sales order can only be updated in DRAFT status');
    }
    await this.assertReferencesBelongToCompany(existing.companyId, {
      divisionId: dto.divisionId ?? existing.divisionId,
      branchId: dto.branchId ?? existing.branchId,
      customerId: dto.customerId ?? existing.customerId,
      salespersonId: dto.salespersonId ?? existing.salespersonId,
      cashAccountId: dto.cashAccountId ?? (existing as any).cashAccountId,
      lines: dto.lines,
    });

    const linesToProcess = dto.lines ?? (existing.lines as any[]);
    const { computed, subtotal, totalDiscount, totalTax, totalAmount } =
      calculateLineTotals(linesToProcess);

    const record = await this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
        await tx.salesOrderLine.createMany({
          data: computed.map((line) => ({
            salesOrderId: id,
            productId: line.productId,
            description: line.description,
            quantity: line.quantity,
            unitId: line.unitId,
            unitPrice: line.unitPrice,
            discountAmount: line.discountAmount ?? 0,
            taxAmount: line.taxAmount ?? 0,
            lineTotal: line.lineTotal,
            inventoryLocationId: line.inventoryLocationId,
            batchId: line.batchId,
          })),
        });
      }

      return tx.salesOrder.update({
        where: { id },
        data: {
          ...(dto.customerId !== undefined && { customerId: dto.customerId }),
          ...(dto.customerName !== undefined && { customerName: dto.customerName }),
          ...(dto.salesType && { salesType: dto.salesType }),
          ...(dto.orderDate && { orderDate: new Date(dto.orderDate) }),
          ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
          ...(dto.currency && { currency: dto.currency }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
          ...(dto.branchId !== undefined && { branchId: dto.branchId }),
          ...(dto.salespersonId !== undefined && { salespersonId: dto.salespersonId }),
          ...(dto.paymentMethod !== undefined && { paymentMethod: dto.paymentMethod }),
          ...(dto.cashAccountId !== undefined && { cashAccountId: dto.cashAccountId }),
          ...(dto.paymentReference !== undefined && { paymentReference: dto.paymentReference }),
          ...(dto.lines && {
            subtotal,
            discountAmount: totalDiscount,
            taxAmount: totalTax,
            totalAmount,
            outstandingAmount: totalAmount,
          }),
        },
      });
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_UPDATE',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return this.findOne(id, user);
  }

  private async assertReferencesBelongToCompany(companyId: string, refs: SalesOrderReferenceIds) {
    if (refs.divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: refs.divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    if (refs.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: refs.branchId, deletedAt: null },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== companyId) {
        throw new BadRequestException('Branch does not belong to this company');
      }
      if (refs.divisionId && branch.divisionId !== refs.divisionId) {
        throw new BadRequestException('Branch does not belong to the selected division');
      }
    }

    if (refs.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: refs.customerId, deletedAt: null },
        select: { companyId: true, divisionId: true, branchId: true },
      });
      if (!customer || customer.companyId !== companyId) {
        throw new BadRequestException('Customer does not belong to this company');
      }
      if (!refs.branchId) {
        throw new BadRequestException('Sales order branch is required for this customer');
      }
      if (customer.branchId && refs.branchId !== customer.branchId) {
        throw new BadRequestException('Customer does not belong to the selected branch');
      }
      if (customer.divisionId && refs.divisionId && refs.divisionId !== customer.divisionId) {
        throw new BadRequestException('Customer does not belong to the selected division');
      }
    }

    if (refs.salespersonId) {
      const salesperson = await this.prisma.employee.findFirst({
        where: { id: refs.salespersonId, deletedAt: null },
        select: { companyId: true },
      });
      if (!salesperson || salesperson.companyId !== companyId) {
        throw new BadRequestException('Salesperson does not belong to this company');
      }
    }

    if (refs.cashAccountId) {
      const cashAccount = await this.prisma.cashAccount.findFirst({
        where: { id: refs.cashAccountId, deletedAt: null, isActive: true },
        select: { companyId: true },
      });
      if (!cashAccount || cashAccount.companyId !== companyId) {
        throw new BadRequestException('Cash account does not belong to this company');
      }
    }

    await this.assertLineReferencesBelongToCompany(companyId, refs.lines, refs.branchId);
  }

  private async assertLineReferencesBelongToCompany(
    companyId: string,
    lines: SalesOrderLineDto[] | undefined,
    branchId?: string | null,
  ) {
    if (!lines?.length) return;

    const unique = (ids: Array<string | undefined>) =>
      Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
    const productIds = unique(lines.map((line) => line.productId));
    const inventoryLocationIds = unique(lines.map((line) => line.inventoryLocationId));
    const unitIds = unique(lines.map((line) => line.unitId));
    const batchIds = unique(lines.map((line) => line.batchId));

    const [products, inventoryLocations, units, batches] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: { id: true, companyId: true },
      }),
      inventoryLocationIds.length
        ? this.prisma.inventoryLocation.findMany({
            where: {
              id: { in: inventoryLocationIds },
              deletedAt: null,
              isActive: true,
            },
            select: { id: true, companyId: true, branchId: true },
          })
        : Promise.resolve([]),
      this.prisma.unitOfMeasure.findMany({
        where: { id: { in: unitIds }, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, companyId: true },
      }),
      batchIds.length
        ? this.prisma.productBatch.findMany({
            where: { id: { in: batchIds }, deletedAt: null },
            select: { id: true, companyId: true, productId: true },
          })
        : Promise.resolve([]),
    ]);

    const validProductIds = new Set(
      products.filter((product) => product.companyId === companyId).map((product) => product.id),
    );
    if (validProductIds.size !== productIds.length) {
      throw new BadRequestException('Sales order product does not belong to this company');
    }

    const validLocationIds = new Set(
      inventoryLocations
        .filter((location) => location.companyId === companyId && (!branchId || location.branchId === branchId))
        .map((location) => location.id),
    );
    if (validLocationIds.size !== inventoryLocationIds.length) {
      throw new BadRequestException(
        branchId
          ? 'Sales order inventory location does not belong to the selected branch'
          : 'Sales order inventory location does not belong to this company',
      );
    }

    const validUnitIds = new Set(
      units
        .filter((unit) => unit.companyId === null || unit.companyId === companyId)
        .map((unit) => unit.id),
    );
    if (validUnitIds.size !== unitIds.length) {
      throw new BadRequestException('Sales order unit does not belong to this company');
    }

    const batchById = new Map(batches.map((batch) => [batch.id, batch]));
    for (const line of lines) {
      if (!line.batchId) continue;
      const batch = batchById.get(line.batchId);
      if (!batch || batch.companyId !== companyId || batch.productId !== line.productId) {
        throw new BadRequestException('Sales order batch does not belong to this company');
      }
    }
  }

  async confirm(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT sales orders can be confirmed');
    }

    const record = await this.prisma.$transaction(async (tx) => {
      for (const line of existing.lines as any[]) {
        const product = await tx.product.findUnique({ where: { id: line.productId } });
        if (!product?.trackInventory) continue;

        if (!line.inventoryLocationId) {
          throw new BadRequestException(
            `Product "${product.name}" is inventory-tracked but line has no inventoryLocationId`,
          );
        }

        try {
          await this.inventoryMovements.createMovement({
            companyId: existing.companyId,
            productId: line.productId,
            inventoryLocationId: line.inventoryLocationId,
            movementType: 'SALE_ISSUE',
            quantity: Number(line.quantity),
            unitId: line.unitId,
            movementDate: existing.orderDate,
            createdById: userId,
            referenceType: 'SalesOrder',
            referenceId: id,
            divisionId: existing.divisionId ?? undefined,
            branchId: existing.branchId ?? undefined,
            tx,
          });
        } catch (err: any) {
          throw new BadRequestException(
            `Failed to create inventory movement for product "${product.name}": ${err.message}`,
          );
        }

        // Decrement the specific batch's remainingQuantity if a batch was picked.
        if (line.batchId) {
          await tx.productBatch.update({
            where: { id: line.batchId },
            data: { remainingQuantity: { decrement: Number(line.quantity) } },
          });
        }
      }

      // ── Payment routing ────────────────────────────────────────────────
      // Non-CREDIT methods credit the chosen cash account immediately and
      // mark the order PAID. CREDIT creates a Receivable instead.
      const paymentMethod = (existing as any).paymentMethod ?? 'CREDIT';
      let paymentStatus: 'UNPAID' | 'PAID' = 'UNPAID';
      let paidAmount = 0;
      let outstandingAmount = Number(existing.totalAmount);
      let receivableId: string | null = null;

      if (paymentMethod === 'CREDIT') {
        if (existing.customerId) {
          const recNumber = await this.codes.next({
            entityType: 'Receivable',
            companyId: existing.companyId,
            tx,
          });
          const receivable = await tx.receivable.create({
            data: {
              receivableNumber: recNumber,
              companyId: existing.companyId,
              customerId: existing.customerId,
              customerName: existing.customerName ?? '',
              amount: existing.totalAmount,
              paidAmount: 0,
              outstandingAmount: existing.totalAmount,
              currency: existing.currency,
              issueDate: new Date(),
              dueDate: existing.dueDate ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
              status: 'OPEN' as any,
              sourceType: 'SalesOrder',
              sourceId: id,
              notes: `Sales Order ${existing.salesOrderNumber}`,
            },
          });
          receivableId = receivable.id;
        }
      } else if ((existing as any).cashAccountId) {
        // Credit the cash account balance.
        await tx.cashAccount.update({
          where: { id: (existing as any).cashAccountId },
          data: { currentBalance: { increment: existing.totalAmount } },
        });
        paymentStatus = 'PAID';
        paidAmount = Number(existing.totalAmount);
        outstandingAmount = 0;
      }

      // ── Tax auto-apply (Sprint C2) ───────────────────────────────────────
      // Mirror line-level taxAmount values into the TaxTransaction ledger so
      // C3 filing reports can aggregate them. Soft-fails: any error inside
      // the auto-apply is logged inside the service and does NOT roll back
      // the order confirmation. Env-flag gated (TAX_AUTO_APPLY=true).
      try {
        const taxResult = await this.taxAutoApply.applyForSalesOrder(id, userId, tx);
        if (taxResult.error) {
          this.logger.warn(`Tax auto-apply for order ${id}: ${taxResult.error}`);
        }
      } catch (err) {
        this.logger.warn(
          `Tax auto-apply threw for order ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return tx.salesOrder.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedById: userId,
          confirmedAt: new Date(),
          paymentStatus,
          paidAmount,
          outstandingAmount,
          ...(receivableId ? { receivableId } : {}),
        },
      });
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_CONFIRM',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'CONFIRMED' } as any,
      severity: AuditSeverity.MEDIUM,
    });

    // Auto-create a DRAFT SalesCommission when the order has a salesperson
    // with a defaultCommissionRate set. Idempotent: the unique key on
    // (salesOrderId, employeeId) means a prior commission blocks a duplicate
    // (e.g. if the order is unconfirmed/reconfirmed). Soft-fails so a
    // configuration gap doesn't break the confirmation flow.
    try {
      await this.maybeCreateAutoCommission(id, userId);
    } catch (err) {
      this.logger.warn(
        `Auto-commission creation failed for order ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return this.findOne(id, user);
  }

  /**
   * Helper for `confirm()` — looks up the salesperson and rate, computes
   * a GROSS-basis commission amount, and creates the row. Skips silently
   * when there's no salesperson, no rate, or a commission already exists.
   */
  private async maybeCreateAutoCommission(orderId: string, userId: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        companyId: true,
        salespersonId: true,
        subtotal: true,
        currency: true,
      },
    });
    if (!order?.salespersonId) return;

    const salesperson = await this.prisma.employee.findFirst({
      where: { id: order.salespersonId, companyId: order.companyId, deletedAt: null },
      select: { id: true, defaultCommissionRate: true },
    });
    if (!salesperson?.defaultCommissionRate) return;

    const existing = await this.prisma.salesCommission.findFirst({
      where: { salesOrderId: orderId, employeeId: salesperson.id, deletedAt: null },
      select: { id: true },
    });
    if (existing) return;

    const rate = Number(salesperson.defaultCommissionRate);
    const subtotal = Number(order.subtotal);
    const amount = Math.round(subtotal * rate * 100) / 100;

    await this.prisma.salesCommission.create({
      data: {
        companyId: order.companyId,
        employeeId: salesperson.id,
        salesOrderId: order.id,
        basis: 'GROSS',
        rate,
        amount,
        currency: order.currency,
        status: 'DRAFT',
        notes: 'Auto-created on order confirmation',
        createdById: userId,
      },
    });
  }

  /**
   * One-shot create + confirm in a single operator action — the heart of the
   * Quick Sale flow (Westsides W2). Internally still creates the SalesOrder
   * first (its own transaction) then confirms (a second transaction that
   * issues inventory, decrements batches, posts the cash receipt or
   * receivable, and auto-creates a commission). If `confirm` throws, the
   * created DRAFT order is left in the database — the operator sees it in
   * the regular list and can retry or delete.
   */
  async quickSale(dto: CreateSalesOrderDto, user: AuthUser) {
    // Quick-sale defaults: never CREDIT (a counter sale is paid before
    // walking out). Operators who need credit should use the standard
    // Sales Order flow.
    const safeDto: CreateSalesOrderDto = {
      ...dto,
      paymentMethod:
        dto.paymentMethod && dto.paymentMethod !== 'CREDIT' ? dto.paymentMethod : 'CASH',
    };
    const draft = await this.create(safeDto, user);
    return this.confirm(draft.id, user);
  }

  async cancel(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'CONFIRMED'].includes(existing.status as string)) {
      throw new BadRequestException('Only DRAFT or CONFIRMED sales orders can be cancelled');
    }

    const record = await this.prisma.$transaction(async (tx) => {
      if (existing.status === 'CONFIRMED') {
        for (const line of existing.lines as any[]) {
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product?.trackInventory || !line.inventoryLocationId) continue;

          try {
            await this.inventoryMovements.createMovement({
              companyId: existing.companyId,
              productId: line.productId,
              inventoryLocationId: line.inventoryLocationId,
              movementType: 'SALES_RETURN',
              quantity: Number(line.quantity),
              unitId: line.unitId,
              movementDate: new Date(),
              createdById: userId,
              referenceType: 'SalesOrder',
              referenceId: id,
              notes: `Reversal: cancellation of sales order ${existing.salesOrderNumber}`,
              divisionId: existing.divisionId ?? undefined,
              branchId: existing.branchId ?? undefined,
              tx,
            });
          } catch (err: any) {
            throw new BadRequestException(
              `Failed to reverse inventory movement for product "${product.name}": ${err.message}`,
            );
          }
        }
      }

      return tx.salesOrder.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_CANCEL',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'CANCELLED' } as any,
      severity: AuditSeverity.MEDIUM,
    });

    return this.findOne(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT sales orders can be deleted');
    }

    await this.prisma.salesOrder.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'SALES_ORDER_DELETE',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }
}
