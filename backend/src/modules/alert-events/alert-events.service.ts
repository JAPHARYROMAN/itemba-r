import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AlertType, NotificationPriority } from '@prisma/client';
import { CreateAlertEventDto } from './dto/create-alert-event.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class AlertEventsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  async createAlertEvent(data: {
    alertRuleId?: string;
    companyId?: string;
    alertType: AlertType;
    title: string;
    message: string;
    linkedEntityType?: string;
    linkedEntityId?: string;
    priority?: NotificationPriority;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const alertEventNumber = `EVT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    await this.prisma.alertEvent.create({
      data: {
        alertEventNumber,
        alertRuleId: data.alertRuleId,
        companyId: data.companyId,
        alertType: data.alertType,
        title: data.title,
        message: data.message,
        linkedEntityType: data.linkedEntityType,
        linkedEntityId: data.linkedEntityId,
        priority: data.priority ?? 'NORMAL',
        status: 'OPEN',
        metadata: data.metadata as any,
      },
    });
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, alertType, status, priority } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);
    if (alertType) where.alertType = alertType;
    if (status) where.status = status;
    if (priority) where.priority = priority;
    const [data, total] = await Promise.all([
      this.prisma.alertEvent.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.alertEvent.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    // Scope the single-record fetch to the caller's company (findAll already
    // does); group-scoped users get no restriction, company-scoped users can't
    // read another company's alert events by guessing an id.
    const where = applyCompanyScopeWhere({ id }, user, null);
    const record = await this.prisma.alertEvent.findFirst({ where });
    if (!record) throw new NotFoundException('Alert event not found');
    return record;
  }

  async acknowledge(id: string, body: { comment?: string }, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.alertEvent.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', acknowledgedById: user.id, acknowledgedAt: new Date() },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AlertEvent', entityId: id, newValue: { status: 'ACKNOWLEDGED' } });
    return record;
  }

  async resolve(id: string, body: { comment?: string }, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.alertEvent.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedById: user.id, resolvedAt: new Date() },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AlertEvent', entityId: id, newValue: { status: 'RESOLVED' } });
    return record;
  }

  async dismiss(id: string, body: { comment?: string }, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.alertEvent.update({
      where: { id },
      data: { status: 'DISMISSED', dismissedById: user.id, dismissedAt: new Date() },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'AlertEvent', entityId: id, newValue: { status: 'DISMISSED' } });
    return record;
  }
}
