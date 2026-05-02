import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class PostingRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    const [items, total] = await Promise.all([
      this.prisma.accountingPostingRule.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { lines: true } }),
      this.prisma.accountingPostingRule.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.accountingPostingRule.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
    if (!item) throw new NotFoundException('Posting rule not found');
    return item;
  }

  async create(dto: any, user: any) {
    const { companyId, ...rest } = dto;
    const item = await this.prisma.accountingPostingRule.create({ data: { ...rest, createdById: user.id, ...(companyId ? { companyId } : {}) } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'AccountingPostingRule', entityId: item.id, userId: user.id, companyId: item.companyId ?? undefined });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.accountingPostingRule.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'AccountingPostingRule', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async remove(id: string, user: any) {
    await this.findOne(id);
    await this.prisma.accountingPostingRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'DELETE', entityType: 'AccountingPostingRule', entityId: id, userId: user.id });
    return { success: true };
  }

  async getLines(ruleId: string) {
    return this.prisma.accountingPostingRuleLine.findMany({ where: { postingRuleId: ruleId }, orderBy: { lineOrder: 'asc' } });
  }

  async addLine(ruleId: string, dto: any, user: any) {
    await this.findOne(ruleId);
    const line = await this.prisma.accountingPostingRuleLine.create({ data: { ...dto, postingRuleId: ruleId } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'AccountingPostingRuleLine', entityId: line.id, userId: user.id });
    return line;
  }
}
