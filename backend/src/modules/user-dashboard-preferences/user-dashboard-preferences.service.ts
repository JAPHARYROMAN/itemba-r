import { Injectable } from '@nestjs/common';
import { AuditScopeKind, Prisma } from '@prisma/client';
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
    return this.prisma.userDashboardPreference.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsert(dashboardId: string, dto: UpsertDashboardPreferenceDto, user: any) {
    const record = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await this.lockDefaultSelection(tx, user.id);
        await tx.userDashboardPreference.updateMany({
          where: {
            userId: user.id,
            dashboardDefinitionId: { not: dashboardId },
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }
      const record = await tx.userDashboardPreference.upsert({
        where: {
          userId_dashboardDefinitionId: { userId: user.id, dashboardDefinitionId: dashboardId },
        },
        create: { userId: user.id, dashboardDefinitionId: dashboardId, ...dto },
        update: { ...dto },
      });
      await this.audit.logStrictInTransaction(tx, {
        userId: user.id,
        action: 'UPSERT',
        entityType: 'UserDashboardPreference',
        entityId: record.id,
        scopeKind: AuditScopeKind.GLOBAL,
        companyScopeIds: [],
        newValue: dto as any,
      });
      return record;
    });
    return record;
  }

  async get(dashboardId: string, user: any) {
    return this.prisma.userDashboardPreference.findUnique({
      where: {
        userId_dashboardDefinitionId: { userId: user.id, dashboardDefinitionId: dashboardId },
      },
    });
  }

  async setDefault(dashboardId: string, user: any) {
    const record = await this.prisma.$transaction(async (tx) => {
      await this.lockDefaultSelection(tx, user.id);
      await tx.userDashboardPreference.updateMany({
        where: {
          userId: user.id,
          dashboardDefinitionId: { not: dashboardId },
          isDefault: true,
        },
        data: { isDefault: false },
      });
      const record = await tx.userDashboardPreference.upsert({
        where: {
          userId_dashboardDefinitionId: { userId: user.id, dashboardDefinitionId: dashboardId },
        },
        create: { userId: user.id, dashboardDefinitionId: dashboardId, isDefault: true },
        update: { isDefault: true },
      });
      await this.audit.logStrictInTransaction(tx, {
        userId: user.id,
        action: 'UPDATE',
        entityType: 'UserDashboardPreference',
        entityId: record.id,
        scopeKind: AuditScopeKind.GLOBAL,
        companyScopeIds: [],
        newValue: { isDefault: true } as any,
      });
      return record;
    });
    return record;
  }

  private async lockDefaultSelection(tx: Prisma.TransactionClient, userId: string) {
    // A stable parent-row lock prevents two transactions selecting different
    // dashboards as default from write-skewing past each other. The companion
    // partial unique index remains a database-level backstop.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`);
  }
}
