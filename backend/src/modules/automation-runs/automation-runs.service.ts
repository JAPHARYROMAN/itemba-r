import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class AutomationRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, ruleId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);
    if (ruleId) where.automationRuleId = ruleId;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.automationRun.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.automationRun.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user?: any) {
    const where: any = { id };
    applyCompanyScopeWhere(where, user);
    const item = await this.prisma.automationRun.findFirst({ where });
    if (!item) throw new NotFoundException('Automation run not found');
    return item;
  }

  async trigger(dto: any, user: any) {
    const { ruleId, companyId } = dto;
    const rule = await this.prisma.automationRule.findFirst({ where: { id: ruleId, deletedAt: null } });
    if (!rule) throw new NotFoundException('Automation rule not found');

    const run = await this.prisma.automationRun.create({
      data: {
        automationRunNumber: `RUN-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        automationRuleId: ruleId,
        companyId: companyId ?? rule.companyId ?? undefined,
        status: 'RUNNING' as any,
        startedById: user.id,
        startedAt: new Date(),
      },
    });

    await this.auditLogs.log({ action: 'TRIGGER', entityType: 'AutomationRun', entityId: run.id, userId: user.id, companyId: run.companyId ?? undefined });
    return run;
  }

  async getItems(runId: string, user?: any) {
    // Scope through the parent run's company: findOne throws if the caller
    // cannot access the run's company, preventing a cross-company item leak.
    await this.findOne(runId, user);
    return this.prisma.automationRunItem.findMany({ where: { automationRunId: runId }, orderBy: { createdAt: 'asc' } });
  }
}
