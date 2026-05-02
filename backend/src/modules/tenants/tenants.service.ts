import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateTenantDto, userId: string) {
    const item = await this.prisma.tenant.create({ data: { ...dto } });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'Tenant', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(companyId?: string, status?: string, tenantType?: string, search?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (tenantType) where.tenantType = tenantType;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { tenantCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.tenant.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { name: true } },
      },
    });
    if (!item) throw new NotFoundException('Tenant not found');
    return item;
  }

  async update(id: string, dto: UpdateTenantDto, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.tenant.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'Tenant', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.tenant.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'Tenant', entityId: id, newValue: {} });
    return { message: 'Tenant deleted' };
  }
}
