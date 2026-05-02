import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, AuditSeverity, WebhookProcessingStatus } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { QueryWebhookEventDto } from './dto/query-webhook-event.dto';
import { WebhookEventControlService } from './webhook-event-control.service';

@Injectable()
export class WebhookEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly webhookControl: WebhookEventControlService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryWebhookEventDto, includeSensitive: boolean, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      providerId,
      webhookEndpointId,
      processingStatus,
      verificationStatus,
    } = query;
    const skip = (page - 1) * limit;
    const where: any = await this.companyScope.companyWhereFor(user, companyId);
    if (providerId) where.providerId = providerId;
    if (webhookEndpointId) where.webhookEndpointId = webhookEndpointId;
    if (processingStatus) where.processingStatus = processingStatus;
    if (verificationStatus) where.verificationStatus = verificationStatus;

    const select: any = {
      id: true,
      webhookEventNumber: true,
      webhookEndpointId: true,
      providerId: true,
      connectionId: true,
      companyId: true,
      eventName: true,
      externalEventId: true,
      verificationStatus: true,
      processingStatus: true,
      linkedEntityType: true,
      linkedEntityId: true,
      errorMessage: true,
      receivedAt: true,
      processedAt: true,
      createdAt: true,
    };
    if (includeSensitive) {
      select.payload = true;
      select.headers = true;
    }

    const [data, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        where,
        select,
        orderBy: { receivedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, includeSensitive: boolean, user: AuthUser) {
    const select: any = {
      id: true,
      webhookEventNumber: true,
      webhookEndpointId: true,
      providerId: true,
      connectionId: true,
      companyId: true,
      eventName: true,
      externalEventId: true,
      verificationStatus: true,
      processingStatus: true,
      linkedEntityType: true,
      linkedEntityId: true,
      errorMessage: true,
      receivedAt: true,
      processedAt: true,
      createdAt: true,
      updatedAt: true,
    };
    if (includeSensitive) {
      select.payload = true;
      select.headers = true;
    }

    const record = await this.prisma.webhookEvent.findFirst({ where: { id }, select });
    if (!record) throw new NotFoundException('Webhook event not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  async reprocess(id: string, user: AuthUser) {
    const userId = user.id;
    const record = await this.prisma.webhookEvent.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Webhook event not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.WRITE);
    this.webhookControl.assertCanReprocess(record);

    const updated = await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        processingStatus: WebhookProcessingStatus.RECEIVED,
        errorMessage: null,
        processedAt: null,
      },
      select: {
        id: true,
        webhookEventNumber: true,
        processingStatus: true,
        updatedAt: true,
      },
    });

    await this.auditLogs.log({
      action: 'WEBHOOK_EVENT_REPROCESSED',
      entityType: 'WebhookEvent',
      entityId: id,
      userId,
      companyId: record.companyId ?? undefined,
      severity: AuditSeverity.LOW,
    });

    return updated;
  }
}
