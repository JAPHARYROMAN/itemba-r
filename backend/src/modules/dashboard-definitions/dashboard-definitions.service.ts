import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateDashboardDefinitionDto } from './dto/create-dashboard-definition.dto';

@Injectable()
export class DashboardDefinitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, dashboardType, isSystemDashboard } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (dashboardType) where.dashboardType = dashboardType;
    if (isSystemDashboard !== undefined) where.isSystemDashboard = isSystemDashboard === 'true' || isSystemDashboard === true;
    const [data, total] = await Promise.all([
      this.prisma.dashboardDefinition.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.dashboardDefinition.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.dashboardDefinition.findFirst({
      where: { id, deletedAt: null },
      include: { widgets: { where: { deletedAt: null } } },
    });
    if (!record) throw new NotFoundException('Dashboard Definition not found');
    return record;
  }

  async create(dto: CreateDashboardDefinitionDto, user: any) {
    const record = await this.prisma.dashboardDefinition.create({ data: { ...dto, createdById: user.id } });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'DashboardDefinition', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: Partial<CreateDashboardDefinitionDto>, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.dashboardDefinition.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'DashboardDefinition', entityId: record.id, newValue: dto as any });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.dashboardDefinition.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'DashboardDefinition', entityId: id, newValue: {} as any });
    return record;
  }
}
