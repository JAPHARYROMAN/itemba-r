import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
  ) {}

  async create(dto: CreateTenantDto, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, dto.companyId);
    const item = await this.prisma.tenant.create({ data: { ...dto } });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'Tenant',
      entityId: item.id,
      companyId: item.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return item;
  }

  async findAll(
    companyId?: string,
    status?: string,
    tenantType?: string,
    search?: string,
    page = 1,
    limit = 20,
    user?: any,
  ) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    if (tenantType) where.tenantType = tenantType;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { tenantCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, user: AuthUser) {
    const item = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { name: true } },
      },
    });
    if (!item) throw new NotFoundException('Tenant not found');
    assertCanAccessCompanyFromUser(user, item.companyId);
    return item;
  }

  async update(id: string, dto: UpdateTenantDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (dto.companyId && dto.companyId !== existing.companyId) {
      assertCanAccessCompanyFromUser(user, dto.companyId);
    }
    const item = await this.prisma.tenant.update({ where: { id }, data: { ...dto } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'Tenant',
      entityId: id,
      companyId: item.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return item;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    await this.prisma.tenant.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'Tenant',
      entityId: id,
      companyId: existing.companyId,
      newValue: {},
    });
    return { message: 'Tenant deleted' };
  }
}
