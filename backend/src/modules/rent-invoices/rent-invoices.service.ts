import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRentInvoiceDto } from './dto/create-rent-invoice.dto';
import { UpdateRentInvoiceDto } from './dto/update-rent-invoice.dto';

@Injectable()
export class RentInvoicesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateRentInvoiceDto, userId: string) {
    const item = await this.prisma.rentInvoice.create({
      data: {
        ...dto,
        invoiceDate: new Date(dto.invoiceDate),
        billingPeriodStart: new Date(dto.billingPeriodStart),
        billingPeriodEnd: new Date(dto.billingPeriodEnd),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'RentInvoice', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(companyId?: string, propertyId?: string, tenantId?: string, leaseAgreementId?: string, status?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (propertyId) where.propertyId = propertyId;
    if (tenantId) where.tenantId = tenantId;
    if (leaseAgreementId) where.leaseAgreementId = leaseAgreementId;
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.rentInvoice.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.rentInvoice.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.rentInvoice.findFirst({
      where: { id, deletedAt: null },
      include: {
        tenant: { select: { name: true } },
        leaseAgreement: { select: { leaseCode: true } },
        rentalUnit: { select: { unitNumber: true } },
      },
    });
    if (!item) throw new NotFoundException('RentInvoice not found');
    return item;
  }

  async update(id: string, dto: UpdateRentInvoiceDto, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.rentInvoice.update({
      where: { id },
      data: {
        ...dto,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
        billingPeriodStart: dto.billingPeriodStart ? new Date(dto.billingPeriodStart) : undefined,
        billingPeriodEnd: dto.billingPeriodEnd ? new Date(dto.billingPeriodEnd) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'RentInvoice', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async issue(id: string, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.rentInvoice.update({
      where: { id },
      data: { status: 'ISSUED' as any },
    });
    await this.audit.log({ userId, action: 'ISSUE', entityType: 'RentInvoice', entityId: id, newValue: { status: 'ISSUED' } });
    return item;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.rentInvoice.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'RentInvoice', entityId: id, newValue: {} });
    return { message: 'RentInvoice deleted' };
  }
}
