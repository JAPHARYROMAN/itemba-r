import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity, ExternalMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateExternalMessageDto } from './dto/create-external-message.dto';
import { QueryExternalMessageDto } from './dto/query-external-message.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class ExternalMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: QueryExternalMessageDto, user?: any) {
    const { page = 1, limit = 20, companyId, channel, status, providerId } = query;
    const skip = (page - 1) * limit;
    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);
    if (channel) where.channel = channel;
    if (status) where.status = status;
    if (providerId) where.providerId = providerId;

    const [data, total] = await Promise.all([
      this.prisma.externalMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.externalMessage.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.externalMessage.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('External message not found');
    return record;
  }

  async create(dto: CreateExternalMessageDto, userId: string) {
    const messageNumber = `MSG-${Date.now().toString(36).toUpperCase()}`;

    const record = await this.prisma.externalMessage.create({
      data: {
        messageNumber,
        companyId: dto.companyId,
        providerId: dto.providerId,
        connectionId: dto.connectionId,
        recipient: dto.recipient,
        recipientType: dto.recipientType,
        channel: dto.channel,
        subject: dto.subject,
        body: dto.body,
        templateId: dto.templateId,
        status: ExternalMessageStatus.QUEUED,
        createdById: userId,
      },
    });

    await this.auditLogs.log({
      action: 'EXTERNAL_MESSAGE_CREATED',
      entityType: 'ExternalMessage',
      entityId: record.id,
      userId,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });

    return record;
  }
}
