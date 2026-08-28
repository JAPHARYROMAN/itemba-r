import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { UpdateProformaInvoiceDto } from './dto/update-proforma-invoice.dto';
import { QueryProformaInvoiceDto } from './dto/query-proforma-invoice.dto';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

function calcLines(lines: any[]) {
  let subtotal = 0,
    totalDiscount = 0,
    totalTax = 0;
  const computed = lines.map((l) => {
    const qty = Number(l.quantity),
      price = Number(l.unitPrice);
    const discount = Number(l.discountAmount ?? 0),
      tax = Number(l.taxAmount ?? 0);
    const lineTotal = qty * price - discount + tax;
    subtotal += qty * price;
    totalDiscount += discount;
    totalTax += tax;
    return { ...l, lineTotal };
  });
  return {
    computed,
    subtotal,
    totalDiscount,
    totalTax,
    totalAmount: subtotal - totalDiscount + totalTax,
  };
}

@Injectable()
export class ProformaInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private async generateProformaNumber(
    db: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const count = await db.proformaInvoice.count({
      where: { companyId, proformaNumber: { startsWith: `PRF-${year}-` } },
    });
    return `PRF-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateProformaInvoiceDto, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, dto.companyId, AccessLevel.WRITE);
    const { computed, subtotal, totalDiscount, totalTax, totalAmount } = calcLines(dto.lines);

    // Generate the per-company proforma number and create the row inside one
    // transaction so the count()+1 read-modify-write is atomic; retry once on a
    // unique-constraint clash (@@unique([companyId, proformaNumber])).
    let record: Awaited<ReturnType<typeof this.prisma.proformaInvoice.create>> | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        record = await this.prisma.$transaction(async (tx) => {
          const proformaNumber = await this.generateProformaNumber(tx, dto.companyId);
          const pf = await tx.proformaInvoice.create({
            data: {
              proformaNumber,
              companyId: dto.companyId,
              divisionId: dto.divisionId,
              branchId: dto.branchId,
              customerId: dto.customerId,
              customerName: dto.customerName,
              proformaDate: new Date(dto.proformaDate),
              validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
              currency: dto.currency as any,
              subtotal,
              discountAmount: totalDiscount,
              taxAmount: totalTax,
              totalAmount,
              status: 'DRAFT' as any,
              quotationId: dto.quotationId,
              createdById: user.id,
              notes: dto.notes,
            },
          });
          await tx.proformaInvoiceLine.createMany({
            data: computed.map((l) => ({
              proformaInvoiceId: pf.id,
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
          return pf;
        });
        break;
      } catch (err) {
        if (
          attempt === 0 &&
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
    }
    if (!record) throw new Error('Failed to allocate proforma invoice number');

    await this.auditLogs.log({
      action: 'PROFORMA_INVOICE_CREATE',
      entityType: 'ProformaInvoice',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
    });
    return this.findOne(record.id, user);
  }

  async findAll(query: QueryProformaInvoiceDto, user?: any) {
    const { page = 1, limit = 20, companyId, status, customerId } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const [data, total] = await Promise.all([
      this.prisma.proformaInvoice.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, customerCode: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.proformaInvoice.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, user?: any) {
    const where: any = { id, deletedAt: null };
    if (user) applyCompanyScopeWhere(where, user);
    const record = await this.prisma.proformaInvoice.findFirst({
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
        customer: {
          select: {
            id: true,
            name: true,
            customerCode: true,
            phone: true,
            email: true,
            address: true,
            contactPerson: true,
          },
        },
        quotation: { select: { id: true, quotationNumber: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true, productCode: true } },
            unit: { select: { id: true, name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Proforma invoice not found');
    return record;
  }

  async update(id: string, dto: UpdateProformaInvoiceDto, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT')
      throw new BadRequestException('Can only update DRAFT proforma invoices');

    await this.prisma.$transaction(async (tx) => {
      if (dto.lines?.length) {
        const calc = calcLines(dto.lines);
        await tx.proformaInvoiceLine.deleteMany({ where: { proformaInvoiceId: id } });
        await tx.proformaInvoiceLine.createMany({
          data: calc.computed.map((l) => ({
            proformaInvoiceId: id,
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
        await tx.proformaInvoice.update({
          where: { id },
          data: {
            subtotal: calc.subtotal,
            discountAmount: calc.totalDiscount,
            taxAmount: calc.totalTax,
            totalAmount: calc.totalAmount,
          },
        });
      }
      await tx.proformaInvoice.update({
        where: { id },
        data: {
          ...(dto.customerId && { customerId: dto.customerId }),
          ...(dto.customerName !== undefined && { customerName: dto.customerName }),
          ...(dto.proformaDate && { proformaDate: new Date(dto.proformaDate) }),
          ...(dto.validUntil !== undefined && {
            validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          }),
          ...(dto.currency && { currency: dto.currency as any }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        } as any,
      });
    });

    await this.auditLogs.log({
      action: 'PROFORMA_INVOICE_UPDATE',
      entityType: 'ProformaInvoice',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return this.findOne(id);
  }

  async send(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT proforma invoices can be sent');
    const record = await this.prisma.proformaInvoice.update({
      where: { id },
      data: { status: 'SENT' as any },
    });
    await this.auditLogs.log({
      action: 'PROFORMA_INVOICE_SENT',
      entityType: 'ProformaInvoice',
      entityId: id,
      userId,
      companyId: record.companyId,
    });
    return record;
  }

  async convertToSalesOrder(id: string, user: AuthUser) {
    const proforma = await this.findOne(id, user);
    assertCanAccessCompanyFromUser(user, proforma.companyId, AccessLevel.WRITE);
    if (proforma.status === 'CONVERTED' && proforma.convertedSalesOrderId) {
      return proforma;
    }
    if (proforma.status !== 'ACCEPTED') {
      throw new BadRequestException('Only ACCEPTED proformas can be converted');
    }

    const salesOrderId = randomUUID();
    const conversionTime = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Claim the conversion with one conditional write. PostgreSQL rechecks
      // the predicate after a competing transaction releases the row lock, so
      // at most one caller can own the ACCEPTED -> CONVERTED transition.
      const claim = await tx.proformaInvoice.updateMany({
        where: {
          id,
          companyId: proforma.companyId,
          status: 'ACCEPTED' as any,
          convertedSalesOrderId: null,
          deletedAt: null,
        },
        // Do not write convertedSalesOrderId until the referenced order exists.
        // The FK is immediate in PostgreSQL, while this status transition still
        // owns the row lock for the remainder of the transaction.
        data: { status: 'CONVERTED' as any },
      });

      if (claim.count !== 1) {
        const current = await tx.proformaInvoice.findUnique({
          where: { id },
          select: { status: true, convertedSalesOrderId: true },
        });
        if (current?.status === 'CONVERTED' && current.convertedSalesOrderId) return;
        throw new BadRequestException('Proforma conversion state changed; refresh and retry');
      }

      await tx.salesOrder.create({
        data: {
          id: salesOrderId,
          salesOrderNumber: `SO-${conversionTime.getFullYear()}-${conversionTime.getTime().toString(36).toUpperCase()}`,
          companyId: proforma.companyId,
          customerId: proforma.customerId,
          divisionId: proforma.divisionId,
          branchId: proforma.branchId,
          // A proforma carries neither payment settlement nor posting authority.
          // Conversion therefore creates a governed credit DRAFT; the separate
          // SalesOrders confirm action owns AR/GL/inventory posting atomically.
          salesType: 'CREDIT_SALE' as any,
          paymentMethod: 'CREDIT' as any,
          orderDate: conversionTime,
          currency: proforma.currency as any,
          subtotal: proforma.subtotal,
          discountAmount: proforma.discountAmount,
          taxAmount: proforma.taxAmount,
          totalAmount: proforma.totalAmount,
          paidAmount: 0,
          outstandingAmount: proforma.totalAmount,
          status: 'DRAFT' as any,
          paymentStatus: 'UNPAID' as any,
          createdById: user.id,
          idempotencyKey: `proforma:${id}`,
          notes: `Converted from proforma ${proforma.proformaNumber}`,
        },
      });

      await tx.salesOrderLine.createMany({
        data: (proforma.lines as any[]).map((l) => ({
          salesOrderId,
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

      await tx.proformaInvoice.update({
        where: { id },
        data: { convertedSalesOrderId: salesOrderId },
      });

      // Conversion success and its audit attribution commit together. A failed
      // append rolls back the claim, order, and lines instead of reporting an
      // unaudited business mutation as successful.
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'PROFORMA_INVOICE_CONVERTED',
        entityType: 'ProformaInvoice',
        entityId: id,
        userId: user.id,
        companyId: proforma.companyId,
        newValue: { convertedSalesOrderId: salesOrderId } as any,
      });
    });

    return this.findOne(id, user);
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT proformas can be deleted');
    await this.prisma.proformaInvoice.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'PROFORMA_INVOICE_DELETE',
      entityType: 'ProformaInvoice',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return { success: true };
  }
}
