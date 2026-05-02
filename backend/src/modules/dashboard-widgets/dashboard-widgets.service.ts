import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateDashboardWidgetDto } from './dto/create-dashboard-widget.dto';

@Injectable()
export class DashboardWidgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(dashboardId: string, user: any, query: any) {
    const { page = 1, limit = 50 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { dashboardDefinitionId: dashboardId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.dashboardWidget.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'asc' } }),
      this.prisma.dashboardWidget.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(dashboardId: string, widgetId: string, user: any) {
    const record = await this.prisma.dashboardWidget.findFirst({ where: { id: widgetId, dashboardDefinitionId: dashboardId, deletedAt: null } });
    if (!record) throw new NotFoundException('Dashboard Widget not found');
    return record;
  }

  async create(dashboardId: string, dto: CreateDashboardWidgetDto, user: any) {
    const record = await this.prisma.dashboardWidget.create({ data: { ...dto, dashboardDefinitionId: dashboardId } });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'DashboardWidget', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(dashboardId: string, widgetId: string, dto: Partial<CreateDashboardWidgetDto>, user: any) {
    await this.findOne(dashboardId, widgetId, user);
    const record = await this.prisma.dashboardWidget.update({ where: { id: widgetId }, data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'DashboardWidget', entityId: widgetId, newValue: dto as any });
    return record;
  }

  async remove(dashboardId: string, widgetId: string, user: any) {
    await this.findOne(dashboardId, widgetId, user);
    const record = await this.prisma.dashboardWidget.update({ where: { id: widgetId }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'DashboardWidget', entityId: widgetId, newValue: {} as any });
    return record;
  }
}
