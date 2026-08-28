import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessLevel, AuditSeverity, ApiKeyStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { hashApiKey } from '../../common/utils/api-key-hash';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { QueryApiKeyDto } from './dto/query-api-key.dto';

const SAFE_SELECT = {
  id: true,
  apiKeyCode: true,
  apiClientId: true,
  keyPrefix: true,
  name: true,
  scopes: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  apiClient: {
    select: { id: true, name: true, companyId: true },
  },
};

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly config: ConfigService,
  ) {}

  async findAll(query: QueryApiKeyDto, user: AuthUser) {
    const { page = 1, limit = 20, apiClientId, status } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    if (apiClientId) {
      const client = await this.getApiClientForAccess(apiClientId, user, AccessLevel.READ);
      where.apiClientId = client.id;
    } else {
      const companyIds = await this.companyScope.accessibleCompanyIds(user);
      if (companyIds) where.apiClient = { companyId: { in: companyIds } };
    }
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.apiKey.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.apiKey.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.apiKey.findFirst({
      where: { id, deletedAt: null },
      select: SAFE_SELECT,
    });
    if (!record) throw new NotFoundException('API key not found');
    await this.companyScope.assertCanAccessCompany(user, record.apiClient.companyId);
    return record;
  }

  async create(dto: CreateApiKeyDto, user: AuthUser) {
    const client = await this.getApiClientForAccess(dto.apiClientId, user, AccessLevel.MANAGE);
    this.assertScopesAllowed(dto.scopes, client.allowedScopes);
    const rawKey = crypto.randomBytes(32).toString('hex');
    const keyPrefix = rawKey.substring(0, 8);
    const keyHash = hashApiKey(rawKey, this.config.getOrThrow<string>('APP_ENCRYPTION_KEY'));
    const apiKeyCode = `KEY-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const record = await this.prisma.apiKey.create({
      data: {
        apiKeyCode,
        apiClientId: client.id,
        keyPrefix,
        keyHash,
        name: dto.name,
        scopes: dto.scopes as any,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        createdById: user.id,
      },
      select: SAFE_SELECT,
    });

    await this.auditLogs.log({
      action: 'API_KEY_CREATED',
      entityType: 'ApiKey',
      entityId: record.id,
      userId: user.id,
      companyId: record.apiClient.companyId ?? undefined,
      severity: AuditSeverity.MEDIUM,
    });

    // rawKey returned ONCE — never stored in plaintext
    return { ...record, rawKey };
  }

  async revoke(id: string, user: AuthUser) {
    const record = await this.prisma.apiKey.findFirst({
      where: { id, deletedAt: null },
      include: { apiClient: { select: { companyId: true } } },
    });
    if (!record) throw new NotFoundException('API key not found');
    await this.companyScope.assertCanAccessCompany(
      user,
      record.apiClient.companyId,
      AccessLevel.MANAGE,
    );

    await this.prisma.apiKey.update({
      where: { id },
      data: {
        status: ApiKeyStatus.REVOKED,
        revokedAt: new Date(),
        deletedAt: new Date(),
      },
    });

    await this.auditLogs.log({
      action: 'API_KEY_REVOKED',
      entityType: 'ApiKey',
      entityId: id,
      userId: user.id,
      companyId: record.apiClient.companyId ?? undefined,
      severity: AuditSeverity.MEDIUM,
    });

    return { success: true };
  }

  private async getApiClientForAccess(apiClientId: string, user: AuthUser, minimum: AccessLevel) {
    const client = await this.prisma.apiClient.findFirst({
      where: { id: apiClientId, deletedAt: null },
      select: { id: true, companyId: true, allowedScopes: true },
    });
    if (!client) throw new NotFoundException('API client not found');
    await this.companyScope.assertCanAccessCompany(user, client.companyId, minimum);
    return client;
  }

  private assertScopesAllowed(requestedScopes: string[], allowedScopes: unknown): void {
    if (
      !Array.isArray(requestedScopes) ||
      !requestedScopes.every((scope) => typeof scope === 'string')
    ) {
      throw new BadRequestException('Requested API key scopes are invalid');
    }

    // allowedScopes is stored as JSON, so treat malformed persisted policy as
    // deny-all rather than accidentally minting a more privileged key.
    if (
      !Array.isArray(allowedScopes) ||
      !allowedScopes.every((scope) => typeof scope === 'string')
    ) {
      throw new BadRequestException('API client allowed scopes are invalid');
    }

    const allowed = new Set(allowedScopes);
    const disallowed = requestedScopes.filter((scope) => !allowed.has(scope));
    if (disallowed.length > 0) {
      throw new BadRequestException('Requested API key scopes exceed the API client allowance');
    }
  }
}
