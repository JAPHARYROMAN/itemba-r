import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, AuditSeverity } from '@prisma/client';
import * as crypto from 'crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { QueryWebhookEndpointDto } from './dto/query-webhook-endpoint.dto';

const SAFE_SELECT = {
  id: true,
  webhookCode: true,
  companyId: true,
  providerId: true,
  connectionId: true,
  name: true,
  endpointPath: true,
  status: true,
  allowedEvents: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
};

@Injectable()
export class WebhookEndpointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryWebhookEndpointDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, providerId, status } = query;
    const skip = (page - 1) * limit;
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (providerId) where.providerId = providerId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.webhookEndpoint.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.webhookEndpoint.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.webhookEndpoint.findFirst({
      where: { id, deletedAt: null },
      select: SAFE_SELECT,
    });
    if (!record) throw new NotFoundException('Webhook endpoint not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  async create(dto: CreateWebhookEndpointDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(dto.companyId ?? null, dto);
    const userId = user.id;

    const existing = await this.prisma.webhookEndpoint.findFirst({
      where: { webhookCode: dto.webhookCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException(`Webhook code "${dto.webhookCode}" already exists`);

    // Generate a secret and store its hash
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

    const record = await this.prisma.webhookEndpoint.create({
      data: {
        webhookCode: dto.webhookCode,
        companyId: dto.companyId,
        providerId: dto.providerId,
        connectionId: dto.connectionId,
        name: dto.name,
        endpointPath: dto.endpointPath,
        status: dto.status,
        allowedEvents: dto.allowedEvents as any,
        secretHash,
        createdById: userId,
      },
      select: SAFE_SELECT,
    });

    await this.auditLogs.log({
      action: 'WEBHOOK_ENDPOINT_CREATED',
      entityType: 'WebhookEndpoint',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });

    // Return rawSecret ONCE — never stored in plaintext
    return { ...record, rawSecret };
  }

  async update(id: string, dto: UpdateWebhookEndpointDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOneRaw(id, user, AccessLevel.WRITE);
    const targetCompanyId = dto.companyId !== undefined ? dto.companyId : existing.companyId;
    await this.companyScope.assertCanAccessCompany(user, targetCompanyId, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(targetCompanyId ?? null, {
      providerId: dto.providerId ?? existing.providerId ?? undefined,
      connectionId: dto.connectionId ?? existing.connectionId ?? undefined,
    });

    const record = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.endpointPath !== undefined && { endpointPath: dto.endpointPath }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.allowedEvents !== undefined && { allowedEvents: dto.allowedEvents as any }),
        ...(dto.companyId !== undefined && { companyId: dto.companyId }),
        ...(dto.providerId !== undefined && { providerId: dto.providerId }),
        ...(dto.connectionId !== undefined && { connectionId: dto.connectionId }),
      },
      select: SAFE_SELECT,
    });

    await this.auditLogs.log({
      action: 'WEBHOOK_ENDPOINT_UPDATED',
      entityType: 'WebhookEndpoint',
      entityId: id,
      userId,
      companyId: record.companyId,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOneRaw(id, user, AccessLevel.WRITE);
    await this.prisma.webhookEndpoint.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'WEBHOOK_ENDPOINT_DELETED',
      entityType: 'WebhookEndpoint',
      entityId: id,
      userId,
      companyId: existing.companyId,
      severity: AuditSeverity.MEDIUM,
    });

    return { success: true };
  }

  private async findOneRaw(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.webhookEndpoint.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Webhook endpoint not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }
    return record;
  }

  private async assertReferencesBelongToCompany(
    companyId: string | null,
    refs: Pick<CreateWebhookEndpointDto, 'providerId' | 'connectionId'>,
  ) {
    if (refs.providerId) {
      const provider = await this.prisma.integrationProvider.findFirst({
        where: { id: refs.providerId, deletedAt: null },
        select: { id: true },
      });
      if (!provider) {
        throw new BadRequestException('Integration provider not found');
      }
    }

    if (!refs.connectionId) return;

    const connection = await this.prisma.integrationConnection.findFirst({
      where: { id: refs.connectionId, deletedAt: null },
      select: { companyId: true, providerId: true },
    });
    if (!connection) {
      throw new BadRequestException('Integration connection not found');
    }
    if (connection.companyId !== companyId) {
      throw new BadRequestException('Integration connection does not belong to this company');
    }
    if (refs.providerId && connection.providerId !== refs.providerId) {
      throw new BadRequestException('Integration connection does not belong to this provider');
    }
  }
}
