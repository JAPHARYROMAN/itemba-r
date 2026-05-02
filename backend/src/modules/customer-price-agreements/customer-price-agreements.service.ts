import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateCustomerPriceAgreementDto } from './dto/create-customer-price-agreement.dto';
import { UpdateCustomerPriceAgreementDto } from './dto/update-customer-price-agreement.dto';
import { QueryCustomerPriceAgreementDto } from './dto/query-customer-price-agreement.dto';

@Injectable()
export class CustomerPriceAgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreateCustomerPriceAgreementDto, userId: string) {
    const record = await this.prisma.customerPriceAgreement.create({
      data: {
        companyId: dto.companyId,
        customerId: dto.customerId,
        priceListId: dto.priceListId,
        productId: dto.productId,
        unitId: dto.unitId,
        agreedPrice: dto.agreedPrice,
        discountPercent: dto.discountPercent,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        status: 'ACTIVE' as any,
        notes: dto.notes,
      },
    });
    await this.auditLogs.log({
      action: 'CUSTOMER_PRICE_AGREEMENT_CREATE',
      entityType: 'CustomerPriceAgreement',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async findAll(query: QueryCustomerPriceAgreementDto) {
    const { page = 1, limit = 20, companyId, customerId, status } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.customerPriceAgreement.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.customerPriceAgreement.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const record = await this.prisma.customerPriceAgreement.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Customer price agreement not found');
    return record;
  }

  async update(id: string, dto: UpdateCustomerPriceAgreementDto, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.customerPriceAgreement.update({
      where: { id },
      data: {
        ...(dto.customerId && { customerId: dto.customerId }),
        ...(dto.priceListId !== undefined && { priceListId: dto.priceListId }),
        ...(dto.productId !== undefined && { productId: dto.productId }),
        ...(dto.unitId !== undefined && { unitId: dto.unitId }),
        ...(dto.agreedPrice !== undefined && { agreedPrice: dto.agreedPrice }),
        ...(dto.discountPercent !== undefined && { discountPercent: dto.discountPercent }),
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
    await this.auditLogs.log({
      action: 'CUSTOMER_PRICE_AGREEMENT_UPDATE',
      entityType: 'CustomerPriceAgreement',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.customerPriceAgreement.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'CUSTOMER_PRICE_AGREEMENT_DELETE',
      entityType: 'CustomerPriceAgreement',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return { success: true };
  }

  async approve(id: string, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.customerPriceAgreement.update({
      where: { id },
      data: { status: 'ACTIVE' as any, approvedById: userId, approvedAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'CUSTOMER_PRICE_AGREEMENT_APPROVE',
      entityType: 'CustomerPriceAgreement',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'ACTIVE' } as any,
    });
    return record;
  }
}
