import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { UpdateProformaInvoiceDto } from './dto/update-proforma-invoice.dto';
import { QueryProformaInvoiceDto } from './dto/query-proforma-invoice.dto';
import { applyCompanyScopeWhere } from '../../common/services';

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
export class ProformaInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private async generateProformaNumber(companyId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.proformaInvoice.count({
      where: { companyId, proformaNumber: { startsWith: `PRF-${year}` } },
    });
    return `PRF-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateProformaInvoiceDto, userId: string) {
    const { computed, subtotal, totalDiscount, totalTax, totalAmount } = calcLines(dto.lines);
    const proformaNumber = await this.generateProformaNumber(dto.companyId);

    const record = await this.prisma.$transaction(async (tx) => {
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
          createdById: userId,
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

    await this.auditLogs.log({
      action: 'PROFORMA_INVOICE_CREATE',
      entityType: 'ProformaInvoice',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return this.findOne(record.id);
  }

  async findAll(query: QueryProformaInvoiceDto, user?: any) {
    const { page = 1, limit = 20, companyId, status, customerId } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const [data, total] = await Promise.all([
      this.prisma.proformaInvoice.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.proformaInvoice.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const record = await this.prisma.proformaInvoice.findFirst({
      where: { id, deletedAt: null },
      include: { lines: true },
    });
    if (!record) throw new NotFoundException('Proforma invoice not found');
    return record;
  }

  async update(id: string, dto: UpdateProformaInvoiceDto, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Can only update DRAFT proforma invoices');

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
          ...(dto.validUntil !== undefined && { validUntil: dto.validUntil ? new Date(dto.validUntil) : null }),
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
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT proforma invoices can be sent');
    const record = await this.prisma.proformaInvoice.update({ where: { id }, data: { status: 'SENT' as any } });
    await this.auditLogs.log({
      action: 'PROFORMA_INVOICE_SENT',
      entityType: 'ProformaInvoice',
      entityId: id,
      userId,
      companyId: record.companyId,
    });
    return record;
  }

  async convertToSalesOrder(id: string, userId: string) {
    const proforma = await this.findOne(id);
    if (proforma.status !== 'ACCEPTED') throw new BadRequestException('Only ACCEPTED proformas can be converted');

    const so = await this.prisma.salesOrder.create({
      data: {
        salesOrderNumber: `SO-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`,
        companyId: proforma.companyId,
        customerId: proforma.customerId,
        divisionId: proforma.divisionId,
        branchId: proforma.branchId,
        salesType: 'CASH_SALE' as any,
        orderDate: new Date(),
        currency: proforma.currency as any,
        subtotal: proforma.subtotal,
        discountAmount: proforma.discountAmount,
        taxAmount: proforma.taxAmount,
        totalAmount: proforma.totalAmount,
        paidAmount: 0,
        outstandingAmount: proforma.totalAmount,
        status: 'CONFIRMED' as any,
        paymentStatus: 'UNPAID' as any,
        createdById: userId,
        notes: `Converted from proforma ${proforma.proformaNumber}`,
      },
    });

    await this.prisma.salesOrderLine.createMany({
      data: (proforma.lines as any[]).map((l) => ({
        salesOrderId: so.id,
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

    await this.prisma.proformaInvoice.update({
      where: { id },
      data: { status: 'CONVERTED' as any, convertedSalesOrderId: so.id },
    });

    await this.auditLogs.log({
      action: 'PROFORMA_INVOICE_CONVERTED',
      entityType: 'ProformaInvoice',
      entityId: id,
      userId,
      companyId: proforma.companyId,
      newValue: { convertedSalesOrderId: so.id } as any,
    });
    return this.findOne(id);
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT proformas can be deleted');
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
