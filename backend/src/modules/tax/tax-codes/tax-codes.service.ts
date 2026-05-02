import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateTaxCodeDto } from './dto/create-tax-code.dto';
import { UpdateTaxCodeDto } from './dto/update-tax-code.dto';

@Injectable()
export class TaxCodesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, taxTypeId, appliesTo, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    if (companyId) where.companyId = companyId;
    if (taxTypeId) where.taxTypeId = taxTypeId;
    if (appliesTo) where.appliesTo = appliesTo;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.taxCode.findMany({ where, skip, take: Number(limit), orderBy: { name: 'asc' } }),
      this.prisma.taxCode.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.taxCode.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Tax code not found');
    return record;
  }

  async create(dto: CreateTaxCodeDto, user: any) {
    const record = await this.prisma.taxCode.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'TaxCode', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateTaxCodeDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxCode.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxCode', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.taxCode.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'TaxCode', entityId: id, newValue: {} });
    return { message: 'Tax code deleted' };
  }
}
