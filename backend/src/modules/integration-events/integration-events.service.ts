import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { QueryIntegrationEventDto } from './dto/query-integration-event.dto';

@Injectable()
export class IntegrationEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: QueryIntegrationEventDto, includeSensitive: boolean) {
    const { page = 1, limit = 20, companyId, providerId, connectionId, eventType, status, direction } = query;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (providerId) where.providerId = providerId;
    if (connectionId) where.connectionId = connectionId;
    if (eventType) where.eventType = eventType;
    if (status) where.status = status;
    if (direction) where.direction = direction;

    const select: any = {
      id: true,
      eventNumber: true,
      companyId: true,
      providerId: true,
      connectionId: true,
      eventType: true,
      direction: true,
      entityType: true,
      entityId: true,
      status: true,
      errorMessage: true,
      correlationId: true,
      createdAt: true,
      updatedAt: true,
    };
    if (includeSensitive) {
      select.requestPayload = true;
      select.responsePayload = true;
    }

    const [data, total] = await Promise.all([
      this.prisma.integrationEvent.findMany({
        where,
        select,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.integrationEvent.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, includeSensitive: boolean) {
    const select: any = {
      id: true,
      eventNumber: true,
      companyId: true,
      providerId: true,
      connectionId: true,
      eventType: true,
      direction: true,
      entityType: true,
      entityId: true,
      status: true,
      errorMessage: true,
      correlationId: true,
      idempotencyKey: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    };
    if (includeSensitive) {
      select.requestPayload = true;
      select.responsePayload = true;
    }

    const record = await this.prisma.integrationEvent.findFirst({ where: { id }, select });
    if (!record) throw new NotFoundException('Integration event not found');
    return record;
  }
}
