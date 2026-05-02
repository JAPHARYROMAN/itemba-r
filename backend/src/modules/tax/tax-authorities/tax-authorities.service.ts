import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateTaxAuthorityDto } from './dto/create-tax-authority.dto';
import { UpdateTaxAuthorityDto } from './dto/update-tax-authority.dto';

@Injectable()
export class TaxAuthoritiesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, search, authorityType, status, country } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { authorityCode: { contains: search, mode: 'insensitive' } }];
    if (authorityType) where.authorityType = authorityType;
    if (status) where.status = status;
    if (country) where.country = { contains: country, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      this.prisma.taxAuthority.findMany({ where, skip, take: Number(limit), orderBy: { name: 'asc' } }),
      this.prisma.taxAuthority.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.taxAuthority.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Tax authority not found');
    return record;
  }

  async create(dto: CreateTaxAuthorityDto, user: any) {
    const record = await this.prisma.taxAuthority.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'TaxAuthority', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateTaxAuthorityDto, user: any) {
    await this.findOne(id);
    const record = await this.prisma.taxAuthority.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxAuthority', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id);
    await this.prisma.taxAuthority.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'TaxAuthority', entityId: id, newValue: {} });
    return { message: 'Tax authority deleted' };
  }
}
