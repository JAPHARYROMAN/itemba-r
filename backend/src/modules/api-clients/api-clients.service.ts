import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, AuditSeverity } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateApiClientDto } from './dto/create-api-client.dto';
import { UpdateApiClientDto } from './dto/update-api-client.dto';
import { QueryApiClientDto } from './dto/query-api-client.dto';

@Injectable()
export class ApiClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryApiClientDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, clientType, status, search } = query;
    const skip = (page - 1) * limit;
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (clientType) where.clientType = clientType;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { clientCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.apiClient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.apiClient.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.apiClient.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('API client not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  async create(dto: CreateApiClientDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const existing = await this.prisma.apiClient.findFirst({
      where: { clientCode: dto.clientCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException(`Client code "${dto.clientCode}" already exists`);

    const record = await this.prisma.apiClient.create({
      data: {
        clientCode: dto.clientCode,
        companyId: dto.companyId,
        name: dto.name,
        clientType: dto.clientType,
        status: dto.status,
        description: dto.description,
        allowedScopes: dto.allowedScopes as any,
        allowedIpAddresses: dto.allowedIpAddresses as any,
        rateLimitPerMinute: dto.rateLimitPerMinute,
        rateLimitPerDay: dto.rateLimitPerDay,
        createdById: userId,
      },
    });

    await this.auditLogs.log({
      action: 'API_CLIENT_CREATED',
      entityType: 'ApiClient',
      entityId: record.id,
      userId,
      companyId: record.companyId ?? undefined,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async update(id: string, dto: UpdateApiClientDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOneRaw(id, user, AccessLevel.WRITE);
    const record = await this.prisma.apiClient.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.clientType !== undefined && { clientType: dto.clientType }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.allowedScopes !== undefined && { allowedScopes: dto.allowedScopes as any }),
        ...(dto.allowedIpAddresses !== undefined && {
          allowedIpAddresses: dto.allowedIpAddresses as any,
        }),
        ...(dto.rateLimitPerMinute !== undefined && { rateLimitPerMinute: dto.rateLimitPerMinute }),
        ...(dto.rateLimitPerDay !== undefined && { rateLimitPerDay: dto.rateLimitPerDay }),
      },
    });

    await this.auditLogs.log({
      action: 'API_CLIENT_UPDATED',
      entityType: 'ApiClient',
      entityId: id,
      userId,
      oldValue: existing as any,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOneRaw(id, user, AccessLevel.WRITE);
    await this.prisma.apiClient.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'API_CLIENT_DELETED',
      entityType: 'ApiClient',
      entityId: id,
      userId,
      oldValue: existing as any,
      severity: AuditSeverity.MEDIUM,
    });

    return { success: true };
  }

  private async findOneRaw(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.apiClient.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('API client not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }
    return record;
  }
}
