import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateLeaseAgreementDto } from './dto/create-lease-agreement.dto';
import { UpdateLeaseAgreementDto } from './dto/update-lease-agreement.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class LeaseAgreementsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateLeaseAgreementDto, userId: string) {
    const item = await this.prisma.leaseAgreement.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'LeaseAgreement', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(companyId?: string, propertyId?: string, rentalUnitId?: string, tenantId?: string, status?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (propertyId) where.propertyId = propertyId;
    if (rentalUnitId) where.rentalUnitId = rentalUnitId;
    if (tenantId) where.tenantId = tenantId;
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.leaseAgreement.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.leaseAgreement.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.leaseAgreement.findFirst({
      where: { id, deletedAt: null },
      include: {
        rentalUnit: { select: { unitNumber: true, unitCode: true } },
        tenant: { select: { name: true, tenantCode: true } },
        property: { select: { propertyName: true } },
      },
    });
    if (!item) throw new NotFoundException('LeaseAgreement not found');
    return item;
  }

  async update(id: string, dto: UpdateLeaseAgreementDto, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.leaseAgreement.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'LeaseAgreement', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async approve(id: string, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.leaseAgreement.update({
      where: { id },
      data: { approvedById: userId, approvedAt: new Date(), status: 'ACTIVE' as any },
    });
    await this.audit.log({ userId, action: 'APPROVE', entityType: 'LeaseAgreement', entityId: id, newValue: { approvedById: userId } });
    return item;
  }

  async terminate(id: string, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.leaseAgreement.update({
      where: { id },
      data: { status: 'TERMINATED' as any },
    });
    await this.audit.log({ userId, action: 'TERMINATE', entityType: 'LeaseAgreement', entityId: id, newValue: { status: 'TERMINATED' } });
    return item;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.leaseAgreement.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'LeaseAgreement', entityId: id, newValue: {} });
    return { message: 'LeaseAgreement deleted' };
  }
}
