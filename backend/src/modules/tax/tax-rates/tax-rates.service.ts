import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateTaxRateDto } from './dto/create-tax-rate.dto';
import { UpdateTaxRateDto } from './dto/update-tax-rate.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class TaxRatesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, taxTypeId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (taxTypeId) where.taxTypeId = taxTypeId;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.taxRate.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.taxRate.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findCurrent(user: any, query: any) {
    const { taxTypeId, companyId } = query;
    const where: any = { deletedAt: null, status: 'ACTIVE' };
    if (taxTypeId) where.taxTypeId = taxTypeId;
    applyCompanyScopeWhere(where, user, companyId);
    return this.prisma.taxRate.findFirst({ where, orderBy: { effectiveFrom: 'desc' } });
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.taxRate.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Tax rate not found');
    return record;
  }

  async create(dto: CreateTaxRateDto, user: any) {
    const record = await this.prisma.taxRate.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'TaxRate', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateTaxRateDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxRate.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxRate', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async approve(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxRate.update({ where: { id }, data: { approvedById: user.id, approvedAt: new Date(), status: 'ACTIVE' as any } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxRate', entityId: id, newValue: { status: 'ACTIVE' } });
    return record;
  }

  async deactivate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxRate.update({ where: { id }, data: { status: 'INACTIVE' as any } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxRate', entityId: id, newValue: { status: 'INACTIVE' } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.taxRate.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'TaxRate', entityId: id, newValue: {} });
    return { message: 'Tax rate deleted' };
  }
}
