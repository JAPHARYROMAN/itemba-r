import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QueryQuotationDto } from './dto/query-quotation.dto';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';

function calcLines(lines: any[]) {
  let subtotal = 0, totalDiscount = 0, totalTax = 0;
  const computed = lines.map((l) => {
    const qty = Number(l.quantity), price = Number(l.unitPrice);
    const discount = Number(l.discountAmount ?? 0), tax = Number(l.taxAmount ?? 0);
    const lineTotal = qty * price - discount + tax;
    subtotal += qty * price; totalDiscount += discount; totalTax += tax;
    return { ...l, lineTotal };
  });
  return { computed, subtotal, totalDiscount, totalTax, totalAmount: subtotal - totalDiscount + totalTax };
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly companyScope: CompanyScopeService,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  async create(dto: CreateQuotationDto, user: AuthUser) {
    const userId = user.id;
    // Never trust the client-supplied companyId for authorization: validate it
    // against the caller's access before writing into that company.
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    const { computed, subtotal, totalDiscount, totalTax, totalAmount } = calcLines(dto.lines);

    const record = await this.prisma.$transaction(async (tx) => {
      const quotationNumber = await this.codes.next({
        entityType: 'Quotation',
        companyId: dto.companyId,
        tx,
      });
      const q = await tx.quotation.create({
        data: {
          quotationNumber,
          companyId: dto.companyId,
          divisionId: dto.divisionId,
          branchId: dto.branchId,
          customerId: dto.customerId,
          customerName: dto.customerName,
          quotationType: dto.quotationType,
          quotationDate: new Date(dto.quotationDate),
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
          currency: dto.currency as any,
          subtotal,
          discountAmount: totalDiscount,
          taxAmount: totalTax,
          totalAmount,
          status: 'DRAFT' as any,
          createdById: userId,
          notes: dto.notes,
        },
      });
      await tx.quotationLine.createMany({
        data: computed.map((l) => ({
          quotationId: q.id,
          productId: l.productId,
          description: l.description,
          quantity: l.quantity,
          unitId: l.unitId,
          unitPrice: l.unitPrice,
          discountAmount: l.discountAmount ?? 0,
          taxAmount: l.taxAmount ?? 0,
          lineTotal: l.lineTotal,
        })),
      });
      return q;
    });

    await this.auditLogs.log({
      action: 'QUOTATION_CREATE',
      entityType: 'Quotation',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return this.findOne(record.id, user);
  }

  async findAll(query: QueryQuotationDto, user?: any) {
    const { page = 1, limit = 20, companyId, status, customerId, quotationType } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (quotationType) where.quotationType = quotationType;

    const [data, total] = await Promise.all([
      this.prisma.quotation.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.quotation.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, user?: any) {
    const where: any = { id, deletedAt: null };
    if (user) applyCompanyScopeWhere(where, user);
    const record = await this.prisma.quotation.findFirst({
      where,
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
        customer: { select: { id: true, name: true, customerCode: true, phone: true, email: true, address: true, contactPerson: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true, productCode: true } },
            unit: { select: { id: true, name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Quotation not found');
    return record;
  }

  async update(id: string, dto: UpdateQuotationDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    if (!['DRAFT', 'SENT'].includes(existing.status as string)) {
      throw new BadRequestException('Can only update DRAFT or SENT quotations');
    }
    let subtotal = existing.subtotal, discountAmount = existing.discountAmount,
        taxAmount = existing.taxAmount, totalAmount = existing.totalAmount;

    await this.prisma.$transaction(async (tx) => {
      if (dto.lines?.length) {
        const calc = calcLines(dto.lines);
        subtotal = calc.subtotal as any; discountAmount = calc.totalDiscount as any;
        taxAmount = calc.totalTax as any; totalAmount = calc.totalAmount as any;
        await tx.quotationLine.deleteMany({ where: { quotationId: id } });
        await tx.quotationLine.createMany({
          data: calc.computed.map((l) => ({
            quotationId: id,
            productId: l.productId,
            description: l.description,
            quantity: l.quantity,
            unitId: l.unitId,
            unitPrice: l.unitPrice,
            discountAmount: l.discountAmount ?? 0,
            taxAmount: l.taxAmount ?? 0,
            lineTotal: l.lineTotal,
          })),
        });
      }
      await tx.quotation.update({
        where: { id },
        data: {
          ...(dto.customerId !== undefined && { customerId: dto.customerId }),
          ...(dto.customerName !== undefined && { customerName: dto.customerName }),
          ...(dto.quotationDate && { quotationDate: new Date(dto.quotationDate) }),
          ...(dto.validUntil !== undefined && { validUntil: dto.validUntil ? new Date(dto.validUntil) : null }),
          ...(dto.currency && { currency: dto.currency as any }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.lines?.length && { subtotal, discountAmount, taxAmount, totalAmount }),
        } as any,
      });
    });

    await this.auditLogs.log({
      action: 'QUOTATION_UPDATE',
      entityType: 'Quotation',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return this.findOne(id, user);
  }

  private async changeStatus(id: string, from: string | string[], to: string, user: AuthUser, extra?: any) {
    const userId = user.id;
    const existing = await this.findOne(id, user);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const allowed = Array.isArray(from) ? from : [from];
    if (!allowed.includes(existing.status as string)) {
      throw new BadRequestException(`Cannot transition from ${existing.status} to ${to}`);
    }
    const record = await this.prisma.quotation.update({
      where: { id },
      data: { status: to as any, ...extra },
    });
    await this.auditLogs.log({
      action: 'QUOTATION_STATUS_CHANGED',
      entityType: 'Quotation',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: to } as any,
    });
    return record;
  }

  async send(id: string, user: AuthUser) {
    return this.changeStatus(id, 'DRAFT', 'SENT', user);
  }

  async accept(id: string, user: AuthUser) {
    return this.changeStatus(id, 'SENT', 'ACCEPTED', user, {
      approvedById: user.id,
      approvedAt: new Date(),
    });
  }

  async reject(id: string, user: AuthUser) {
    return this.changeStatus(id, 'SENT', 'REJECTED', user);
  }

  async convertToSalesOrder(id: string, user: AuthUser) {
    const userId = user.id;
    const quotation = await this.findOne(id, user);
    await this.companyScope.assertCanAccessCompany(user, quotation.companyId, AccessLevel.WRITE);
    if (quotation.status !== 'ACCEPTED') throw new BadRequestException('Only ACCEPTED quotations can be converted');

    // Phase 1 (atomic): claim the quotation (ACCEPTED -> CONVERTED) and create
    // the resulting sales order as DRAFT. The order is DRAFT — not CONFIRMED —
    // precisely so it can be routed through SalesOrdersService.confirm() below,
    // which posts the confirmation journal (DR AR, CR Revenue, CR Output VAT;
    // DR COGS, CR Inventory), creates the receivable, and issues stock. The
    // previous implementation created a CONFIRMED order directly and skipped ALL
    // of those side effects, leaving the GL, AR subledger, output-VAT ledger and
    // inventory permanently out of sync with the sales report.
    //
    // The claim is a guarded updateMany (ACCEPTED -> CONVERTED): a concurrent
    // second convert matches 0 rows and throws, so we never produce two orders.
    const created = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.quotation.updateMany({
        where: { id, deletedAt: null, status: 'ACCEPTED' as any },
        data: { status: 'CONVERTED' as any },
      });
      if (claim.count === 0) {
        throw new BadRequestException('Only ACCEPTED quotations can be converted');
      }

      const salesOrderNumber = await this.codes.next({
        entityType: 'SalesOrder',
        companyId: quotation.companyId,
        tx,
      });

      const order = await tx.salesOrder.create({
        data: {
          salesOrderNumber,
          companyId: quotation.companyId,
          customerId: quotation.customerId,
          divisionId: quotation.divisionId,
          branchId: quotation.branchId,
          // A quotation carries no cash-account / payment info, so the converted
          // order settles on credit: confirm() raises a Receivable (DR AR) rather
          // than debiting an (absent) cash account. A cash receipt can be recorded
          // against the receivable afterwards through the normal receivables flow.
          salesType: 'CREDIT_SALE' as any,
          paymentMethod: 'CREDIT' as any,
          orderDate: new Date(),
          currency: quotation.currency as any,
          subtotal: quotation.subtotal,
          discountAmount: quotation.discountAmount,
          taxAmount: quotation.taxAmount,
          totalAmount: quotation.totalAmount,
          paidAmount: 0,
          outstandingAmount: quotation.totalAmount,
          status: 'DRAFT' as any,
          paymentStatus: 'UNPAID' as any,
          createdById: userId,
          notes: `Converted from quotation ${quotation.quotationNumber}`,
        },
      });

      await tx.salesOrderLine.createMany({
        data: (quotation.lines as any[]).map((l) => ({
          salesOrderId: order.id,
          productId: l.productId,
          description: l.description,
          quantity: l.quantity,
          unitId: l.unitId,
          unitPrice: l.unitPrice,
          discountAmount: l.discountAmount,
          taxAmount: l.taxAmount,
          lineTotal: l.lineTotal,
        })),
      });

      await tx.quotation.update({
        where: { id },
        data: { convertedSalesOrderId: order.id },
      });

      return order;
    });

    // Phase 2: confirm the DRAFT order. This runs its own transaction and posts
    // the balanced GL journal, creates + links the Receivable, issues stock
    // (SALE_ISSUE), and stamps journalEntryId/receivableId on the order.
    //
    // Phase 1 and Phase 2 are two SEPARATE transactions, so if confirm() throws
    // (e.g. missing branch for a stock sale, closed period, insufficient stock)
    // the quotation would be left CONVERTED and linked to an unposted DRAFT order
    // — a permanent half-done state the user cannot re-drive from the quotation.
    // To keep the operation effectively all-or-nothing, we run a COMPENSATING
    // action on failure: revert the quotation (CONVERTED -> ACCEPTED, unlink the
    // order) and soft-delete the just-created DRAFT order, then rethrow the
    // ORIGINAL error so the caller sees the real cause and can retry the convert.
    try {
      await this.salesOrders.confirm(created.id, user);
    } catch (confirmError) {
      await this.compensateFailedConversion(id, created.id, quotation.companyId);
      throw confirmError;
    }

    await this.auditLogs.log({
      action: 'QUOTATION_CONVERTED',
      entityType: 'Quotation',
      entityId: id,
      userId,
      companyId: quotation.companyId,
      newValue: { convertedSalesOrderId: created.id } as any,
    });
    return this.findOne(id, user);
  }

  /**
   * Undo the Phase 1 writes when Phase 2 (SalesOrdersService.confirm) fails, so a
   * failed convert leaves the quotation exactly as it was (ACCEPTED, unlinked) and
   * the retry can start clean. Both writes are guarded and idempotent:
   *  - the quotation revert only matches the row we just claimed (status CONVERTED
   *    AND still pointing at this order), so a re-run — or a status the user has
   *    since moved on from — matches 0 rows and is a no-op;
   *  - the order soft-delete only matches a still-DRAFT, not-yet-deleted order, so
   *    it never touches an order that some other flow has since confirmed/deleted.
   *
   * Runs in a single transaction and swallows nothing to the caller: any failure
   * here is logged but must NOT mask the original confirm() error, which the
   * caller rethrows.
   */
  private async compensateFailedConversion(
    quotationId: string,
    salesOrderId: string,
    companyId: string,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.quotation.updateMany({
          where: {
            id: quotationId,
            companyId,
            status: 'CONVERTED' as any,
            convertedSalesOrderId: salesOrderId,
          },
          data: { status: 'ACCEPTED' as any, convertedSalesOrderId: null },
        });
        await tx.salesOrder.updateMany({
          where: {
            id: salesOrderId,
            companyId,
            status: 'DRAFT' as any,
            deletedAt: null,
          },
          data: { deletedAt: new Date() },
        });
      });
      await this.auditLogs.log({
        action: 'QUOTATION_CONVERT_COMPENSATED',
        entityType: 'Quotation',
        entityId: quotationId,
        companyId,
        oldValue: { status: 'CONVERTED', convertedSalesOrderId: salesOrderId } as any,
        newValue: { status: 'ACCEPTED', convertedSalesOrderId: null } as any,
      });
    } catch (compensationError) {
      // Never let a compensation failure hide the real (confirm) error. Log the
      // secondary failure so an operator can reconcile the stuck quotation.
      await this.auditLogs
        .log({
          action: 'QUOTATION_CONVERT_COMPENSATION_FAILED',
          entityType: 'Quotation',
          entityId: quotationId,
          companyId,
          newValue: {
            salesOrderId,
            error: (compensationError as Error)?.message,
          } as any,
        })
        .catch(() => undefined);
    }
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT quotations can be deleted');
    await this.prisma.quotation.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'QUOTATION_DELETE',
      entityType: 'Quotation',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return { success: true };
  }
}
