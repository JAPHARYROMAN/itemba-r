import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateRentInvoiceDto } from './dto/create-rent-invoice.dto';
import { UpdateRentInvoiceDto } from './dto/update-rent-invoice.dto';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';

@Injectable()
export class RentInvoicesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private companyScope: CompanyScopeService,
  ) {}

  async create(dto: CreateRentInvoiceDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(
      user,
      dto.companyId,
      AccessLevel.WRITE,
    );

    const billingPeriodStart = new Date(dto.billingPeriodStart);
    const billingPeriodEnd = new Date(dto.billingPeriodEnd);
    const duplicate = await this.prisma.rentInvoice.findFirst({
      where: {
        companyId: dto.companyId,
        leaseAgreementId: dto.leaseAgreementId,
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'WRITTEN_OFF'] },
        billingPeriodStart: { lt: billingPeriodEnd },
        billingPeriodEnd: { gt: billingPeriodStart },
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        'A rent invoice already covers this lease billing period',
      );
    }

    const item = await this.prisma.rentInvoice.create({
      data: {
        ...dto,
        invoiceDate: new Date(dto.invoiceDate),
        billingPeriodStart,
        billingPeriodEnd,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'RentInvoice', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(companyId?: string, propertyId?: string, tenantId?: string, leaseAgreementId?: string, status?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
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

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.rentInvoice.findFirst({
      where: { id, deletedAt: null },
      include: {
        tenant: { select: { name: true } },
        leaseAgreement: { select: { leaseCode: true } },
        rentalUnit: { select: { unitNumber: true } },
      },
    });
    if (!item) throw new NotFoundException('RentInvoice not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async update(id: string, dto: UpdateRentInvoiceDto, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const {
      companyId: _companyId,
      propertyId: _propertyId,
      rentalUnitId: _rentalUnitId,
      tenantId: _tenantId,
      leaseAgreementId: _leaseAgreementId,
      createdById: _createdById,
      invoiceDate,
      billingPeriodStart,
      billingPeriodEnd,
      dueDate,
      ...rest
    } = dto;
    const item = await this.prisma.rentInvoice.update({
      where: { id },
      data: {
        ...rest,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
        billingPeriodStart: billingPeriodStart ? new Date(billingPeriodStart) : undefined,
        billingPeriodEnd: billingPeriodEnd ? new Date(billingPeriodEnd) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
      },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'RentInvoice', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async issue(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const item = await this.prisma.rentInvoice.update({
      where: { id },
      data: { status: 'ISSUED' as any },
    });
    await this.audit.log({ userId: user.id, action: 'ISSUE', entityType: 'RentInvoice', entityId: id, newValue: { status: 'ISSUED' } });
    return item;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    await this.prisma.rentInvoice.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'RentInvoice', entityId: id, newValue: {} });
    return { message: 'RentInvoice deleted' };
  }
}
