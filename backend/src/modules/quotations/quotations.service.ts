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

    const so = await this.prisma.$transaction(async (tx) => {
      // Re-check status inside the transaction to prevent a double-convert race
      // producing two sales orders (and later duplicate receivables).
      const locked = await tx.quotation.findFirst({
        where: { id, deletedAt: null },
        select: { status: true },
      });
      if (!locked) throw new NotFoundException('Quotation not found');
      if (locked.status !== 'ACCEPTED') {
        throw new BadRequestException('Only ACCEPTED quotations can be converted');
      }

      const salesOrderNumber = await this.codes.next({
        entityType: 'SalesOrder',
        companyId: quotation.companyId,
        tx,
      });

      const created = await tx.salesOrder.create({
        data: {
          salesOrderNumber,
          companyId: quotation.companyId,
          customerId: quotation.customerId,
          divisionId: quotation.divisionId,
          branchId: quotation.branchId,
          salesType: 'CASH_SALE' as any,
          orderDate: new Date(),
          currency: quotation.currency as any,
          subtotal: quotation.subtotal,
          discountAmount: quotation.discountAmount,
          taxAmount: quotation.taxAmount,
          totalAmount: quotation.totalAmount,
          paidAmount: 0,
          outstandingAmount: quotation.totalAmount,
          status: 'CONFIRMED' as any,
          paymentStatus: 'UNPAID' as any,
          createdById: userId,
          notes: `Converted from quotation ${quotation.quotationNumber}`,
        },
      });

      await tx.salesOrderLine.createMany({
        data: (quotation.lines as any[]).map((l) => ({
          salesOrderId: created.id,
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
        data: { status: 'CONVERTED' as any, convertedSalesOrderId: created.id },
      });

      return created;
    });

    await this.auditLogs.log({
      action: 'QUOTATION_CONVERTED',
      entityType: 'Quotation',
      entityId: id,
      userId,
      companyId: quotation.companyId,
      newValue: { convertedSalesOrderId: so.id } as any,
    });
    return this.findOne(id, user);
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
