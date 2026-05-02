import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateTaxFilingPeriodDto } from './dto/create-tax-filing-period.dto';
import { UpdateTaxFilingPeriodDto } from './dto/update-tax-filing-period.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class TaxFilingPeriodsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, taxTypeId, status, filingFrequency } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (taxTypeId) where.taxTypeId = taxTypeId;
    if (status) where.status = status;
    if (filingFrequency) where.filingFrequency = filingFrequency;
    const [data, total] = await Promise.all([
      this.prisma.taxFilingPeriod.findMany({ where, skip, take: Number(limit), orderBy: { periodStart: 'desc' } }),
      this.prisma.taxFilingPeriod.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.taxFilingPeriod.findFirst({ where: { id, deletedAt: null, ...this.companyFilter(user) } });
    if (!record) throw new NotFoundException('Tax filing period not found');
    return record;
  }

  async create(dto: CreateTaxFilingPeriodDto, user: any) {
    const record = await this.prisma.taxFilingPeriod.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'TaxFilingPeriod', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateTaxFilingPeriodDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxFilingPeriod.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxFilingPeriod', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.taxFilingPeriod.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'TaxFilingPeriod', entityId: id, newValue: {} });
    return { message: 'Tax filing period deleted' };
  }
}
