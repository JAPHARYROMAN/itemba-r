import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditScopeKind } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateTaxTypeDto } from './dto/create-tax-type.dto';
import { UpdateTaxTypeDto } from './dto/update-tax-type.dto';

@Injectable()
export class TaxTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, search, taxCategory, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (search)
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { taxTypeCode: { contains: search, mode: 'insensitive' } },
      ];
    if (taxCategory) where.taxCategory = taxCategory;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.taxType.findMany({ where, skip, take: Number(limit), orderBy: { name: 'asc' } }),
      this.prisma.taxType.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.taxType.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Tax type not found');
    return record;
  }

  async create(dto: CreateTaxTypeDto, user: any) {
    const record = await this.prisma.taxType.create({ data: { ...dto } as any });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'TaxType',
      entityId: record.id,
      scopeKind: AuditScopeKind.GLOBAL,
      companyScopeIds: [],
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async update(id: string, dto: UpdateTaxTypeDto, user: any) {
    await this.findOne(id);
    const record = await this.prisma.taxType.update({ where: { id }, data: dto as any });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'TaxType',
      entityId: id,
      scopeKind: AuditScopeKind.GLOBAL,
      companyScopeIds: [],
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id);
    await this.prisma.taxType.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'TaxType',
      entityId: id,
      scopeKind: AuditScopeKind.GLOBAL,
      companyScopeIds: [],
      newValue: {},
    });
    return { message: 'Tax type deleted' };
  }
}
