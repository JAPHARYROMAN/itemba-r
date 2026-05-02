import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateMessageTemplateDto } from './dto/create-message-template.dto';
import { UpdateMessageTemplateDto } from './dto/update-message-template.dto';
import { QueryMessageTemplateDto } from './dto/query-message-template.dto';

@Injectable()
export class MessageTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: QueryMessageTemplateDto) {
    const { page = 1, limit = 20, companyId, channel, templateType, status } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (channel) where.channel = channel;
    if (templateType) where.templateType = templateType;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.messageTemplate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.messageTemplate.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.messageTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Message template not found');
    return record;
  }

  async create(dto: CreateMessageTemplateDto, userId: string) {
    const existing = await this.prisma.messageTemplate.findFirst({
      where: { templateCode: dto.templateCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException(`Template code "${dto.templateCode}" already exists`);

    const record = await this.prisma.messageTemplate.create({
      data: {
        templateCode: dto.templateCode,
        companyId: dto.companyId,
        name: dto.name,
        channel: dto.channel,
        templateType: dto.templateType,
        subject: dto.subject,
        body: dto.body,
        variables: dto.variables as any,
        status: dto.status,
        createdById: userId,
      },
    });

    await this.auditLogs.log({
      action: 'MESSAGE_TEMPLATE_CREATED',
      entityType: 'MessageTemplate',
      entityId: record.id,
      userId,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async update(id: string, dto: UpdateMessageTemplateDto, userId: string) {
    const existing = await this.findOneRaw(id);
    const record = await this.prisma.messageTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.channel !== undefined && { channel: dto.channel }),
        ...(dto.templateType !== undefined && { templateType: dto.templateType }),
        ...(dto.subject !== undefined && { subject: dto.subject }),
        ...(dto.body !== undefined && { body: dto.body }),
        ...(dto.variables !== undefined && { variables: dto.variables as any }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    await this.auditLogs.log({
      action: 'MESSAGE_TEMPLATE_UPDATED',
      entityType: 'MessageTemplate',
      entityId: id,
      userId,
      oldValue: existing as any,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOneRaw(id);
    await this.prisma.messageTemplate.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'MESSAGE_TEMPLATE_DELETED',
      entityType: 'MessageTemplate',
      entityId: id,
      userId,
      oldValue: existing as any,
      severity: AuditSeverity.MEDIUM,
    });

    return { success: true };
  }

  private async findOneRaw(id: string) {
    const record = await this.prisma.messageTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Message template not found');
    return record;
  }
}
