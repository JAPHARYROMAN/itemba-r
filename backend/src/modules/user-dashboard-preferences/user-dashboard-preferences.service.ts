import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UpsertDashboardPreferenceDto } from './dto/upsert-dashboard-preference.dto';

@Injectable()
export class UserDashboardPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(user: any) {
    return this.prisma.userDashboardPreference.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
  }

  async upsert(dashboardId: string, dto: UpsertDashboardPreferenceDto, user: any) {
    const record = await this.prisma.userDashboardPreference.upsert({
      where: { userId_dashboardDefinitionId: { userId: user.id, dashboardDefinitionId: dashboardId } },
      create: { userId: user.id, dashboardDefinitionId: dashboardId, ...dto },
      update: { ...dto },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'UserDashboardPreference', entityId: record.id, newValue: dto as any });
    return record;
  }

  async get(dashboardId: string, user: any) {
    return this.prisma.userDashboardPreference.findUnique({
      where: { userId_dashboardDefinitionId: { userId: user.id, dashboardDefinitionId: dashboardId } },
    });
  }

  async setDefault(dashboardId: string, user: any) {
    await this.prisma.userDashboardPreference.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    const record = await this.prisma.userDashboardPreference.upsert({
      where: { userId_dashboardDefinitionId: { userId: user.id, dashboardDefinitionId: dashboardId } },
      create: { userId: user.id, dashboardDefinitionId: dashboardId, isDefault: true },
      update: { isDefault: true },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'UserDashboardPreference', entityId: record.id, newValue: { isDefault: true } as any });
    return record;
  }
}
