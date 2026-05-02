import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';

@Injectable()
export class AlertRulesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, alertType, isActive } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    else if (user.companyId) where.companyId = user.companyId;
    if (alertType) where.alertType = alertType;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    const [data, total] = await Promise.all([
      this.prisma.alertRule.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.alertRule.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.alertRule.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Alert rule not found');
    return record;
  }

  async create(dto: CreateAlertRuleDto, user: any) {
    const alertRuleCode = `RULE-${Date.now()}`;
    const record = await this.prisma.alertRule.create({
      data: {
        alertRuleCode,
        name: dto.name,
        description: dto.description,
        alertType: dto.alertType,
        companyId: dto.companyId,
        isActive: dto.isActive ?? true,
        frequency: dto.frequency,
        recipientType: dto.recipientType ?? 'ROLE',
        recipientUserId: dto.recipientUserId,
        recipientRoleId: dto.recipientRoleId,
        recipientPermission: dto.recipientPermission,
        priority: dto.priority ?? 'NORMAL',
        entityType: dto.entityType,
        daysBefore: dto.daysBefore,
        condition: (dto.condition ?? {}) as any,
        createdById: user.id,
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'AlertRule', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: Partial<CreateAlertRuleDto>, user: any) {
    await this.findOne(id, user);
    const data: any = { ...dto };
    if (dto.condition !== undefined) data.condition = dto.condition;
    const record = await this.prisma.alertRule.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AlertRule', entityId: id, newValue: dto as any });
    return record;
  }

  async activate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.alertRule.update({ where: { id }, data: { isActive: true } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AlertRule', entityId: id, newValue: { isActive: true } });
    return record;
  }

  async deactivate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.alertRule.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AlertRule', entityId: id, newValue: { isActive: false } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.alertRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'AlertRule', entityId: id, newValue: {} });
    return { message: 'Alert rule deleted' };
  }
}
