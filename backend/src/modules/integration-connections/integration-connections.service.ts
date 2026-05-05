import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AuditSeverity, IntegrationConnectionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateIntegrationConnectionDto } from './dto/create-integration-connection.dto';
import { UpdateIntegrationConnectionDto } from './dto/update-integration-connection.dto';
import { QueryIntegrationConnectionDto } from './dto/query-integration-connection.dto';
import { EncryptionService, applyCompanyScopeWhere } from '../../common/services';

/** Fields that must never be sent to the frontend */
const SAFE_SELECT = {
  id: true,
  connectionCode: true,
  companyId: true,
  divisionId: true,
  branchId: true,
  licensedBusinessUnitId: true,
  providerId: true,
  connectionName: true,
  environment: true,
  status: true,
  publicConfig: true,
  lastTestedAt: true,
  lastSuccessAt: true,
  lastErrorAt: true,
  lastErrorMessage: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
};

@Injectable()
export class IntegrationConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly encryption: EncryptionService,
  ) {}

  async findAll(query: QueryIntegrationConnectionDto, user?: any) {
    const { page = 1, limit = 20, companyId, providerId, status, environment } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (providerId) where.providerId = providerId;
    if (status) where.status = status;
    if (environment) where.environment = environment;

    const [data, total] = await Promise.all([
      this.prisma.integrationConnection.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.integrationConnection.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.integrationConnection.findFirst({
      where: { id, deletedAt: null },
      select: SAFE_SELECT,
    });
    if (!record) throw new NotFoundException('Integration connection not found');
    return record;
  }

  async create(dto: CreateIntegrationConnectionDto, userId: string) {
    const existing = await this.prisma.integrationConnection.findFirst({
      where: { connectionCode: dto.connectionCode, deletedAt: null },
    });
    if (existing)
      throw new BadRequestException(`Connection code "${dto.connectionCode}" already exists`);

    const credentialsEncrypted = dto.credentials ? this.encryptJson(dto.credentials) : undefined;
    const privateConfigEncrypted = dto.privateConfig
      ? this.encryptJson(dto.privateConfig)
      : undefined;

    const record = await this.prisma.integrationConnection.create({
      data: {
        connectionCode: dto.connectionCode,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        licensedBusinessUnitId: dto.licensedBusinessUnitId,
        providerId: dto.providerId,
        connectionName: dto.connectionName,
        environment: dto.environment,
        status: dto.status,
        publicConfig: dto.publicConfig,
        credentialsEncrypted: credentialsEncrypted as any,
        privateConfigEncrypted: privateConfigEncrypted as any,
        createdById: userId,
      },
      select: SAFE_SELECT,
    });

    await this.auditLogs.log({
      action: 'INTEGRATION_CONNECTION_CREATED',
      entityType: 'IntegrationConnection',
      entityId: record.id,
      userId,
      companyId: record.companyId ?? undefined,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async update(id: string, dto: UpdateIntegrationConnectionDto, userId: string) {
    await this.findOneRaw(id);

    const credentialsEncrypted = dto.credentials ? this.encryptJson(dto.credentials) : undefined;
    const privateConfigEncrypted = dto.privateConfig
      ? this.encryptJson(dto.privateConfig)
      : undefined;

    const record = await this.prisma.integrationConnection.update({
      where: { id },
      data: {
        ...(dto.connectionName !== undefined && { connectionName: dto.connectionName }),
        ...(dto.environment !== undefined && { environment: dto.environment }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.publicConfig !== undefined && { publicConfig: dto.publicConfig }),
        ...(credentialsEncrypted !== undefined && {
          credentialsEncrypted: credentialsEncrypted as any,
        }),
        ...(privateConfigEncrypted !== undefined && {
          privateConfigEncrypted: privateConfigEncrypted as any,
        }),
        ...(dto.companyId !== undefined && { companyId: dto.companyId }),
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.licensedBusinessUnitId !== undefined && {
          licensedBusinessUnitId: dto.licensedBusinessUnitId,
        }),
      },
      select: SAFE_SELECT,
    });

    await this.auditLogs.log({
      action: 'INTEGRATION_CONNECTION_UPDATED',
      entityType: 'IntegrationConnection',
      entityId: id,
      userId,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOneRaw(id);
    await this.prisma.integrationConnection.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'INTEGRATION_CONNECTION_DELETED',
      entityType: 'IntegrationConnection',
      entityId: id,
      userId,
      severity: AuditSeverity.MEDIUM,
    });

    return { success: true };
  }

  async testConnection(id: string, userId: string) {
    const connection = await this.findOneWithProvider(id);
    const testedAt = new Date();

    try {
      const probe = await this.probeConnection(connection);
      const record = await this.prisma.integrationConnection.update({
        where: { id },
        data: {
          lastTestedAt: testedAt,
          lastSuccessAt: testedAt,
          lastErrorAt: null,
          lastErrorMessage: null,
          status: IntegrationConnectionStatus.ACTIVE,
        },
        select: SAFE_SELECT,
      });

      await this.auditLogs.log({
        action: 'INTEGRATION_CONNECTION_TESTED',
        entityType: 'IntegrationConnection',
        entityId: id,
        userId,
        severity: AuditSeverity.LOW,
        metadata: probe as any,
      });

      return record;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.integrationConnection.update({
        where: { id },
        data: {
          lastTestedAt: testedAt,
          lastErrorAt: testedAt,
          lastErrorMessage: message.slice(0, 1000),
          status: IntegrationConnectionStatus.ERROR,
        },
      });

      await this.auditLogs.log({
        action: 'INTEGRATION_CONNECTION_TEST_FAILED',
        entityType: 'IntegrationConnection',
        entityId: id,
        userId,
        severity: AuditSeverity.MEDIUM,
        metadata: { error: message } as any,
      });

      throw new BadRequestException(`Integration connection test failed: ${message}`);
    }
  }

  private async findOneRaw(id: string) {
    const record = await this.prisma.integrationConnection.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Integration connection not found');
    return record;
  }

  private async findOneWithProvider(id: string) {
    const record = await this.prisma.integrationConnection.findFirst({
      where: { id, deletedAt: null },
      include: {
        provider: { select: { id: true, providerCode: true, name: true, baseUrl: true } },
      },
    });
    if (!record) throw new NotFoundException('Integration connection not found');
    return record;
  }

  private async probeConnection(connection: Awaited<ReturnType<typeof this.findOneWithProvider>>) {
    const config = this.asRecord(connection.publicConfig);
    const probe = this.resolveProbeTarget(connection, config);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), probe.timeoutMs);

    try {
      const response = await fetch(probe.url, {
        method: probe.method,
        headers: probe.headers,
        signal: controller.signal,
      });
      const durationMs = Date.now() - startedAt;
      if (!this.isExpectedStatus(response.status, probe.expectedStatuses)) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `HTTP ${response.status} from ${probe.url}${body ? `: ${body.slice(0, 200)}` : ''}`,
        );
      }
      return {
        url: probe.url,
        method: probe.method,
        status: response.status,
        durationMs,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timed out after ${probe.timeoutMs}ms probing ${probe.url}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveProbeTarget(
    connection: Awaited<ReturnType<typeof this.findOneWithProvider>>,
    config: Record<string, any>,
  ) {
    const configuredUrl = this.firstString(config.testUrl, config.healthUrl, config.healthCheckUrl);
    const baseUrl = this.firstString(config.baseUrl, connection.provider?.baseUrl);
    const path =
      this.firstString(
        config.testPath,
        config.healthPath,
        config.testEndpoint,
        config.healthEndpoint,
        '/',
      ) ?? '/';
    const rawUrl = configuredUrl ?? (baseUrl ? new URL(path, this.withTrailingSlash(baseUrl)) : '');
    if (!rawUrl) {
      throw new Error(
        'No provider test URL configured. Set provider.baseUrl or publicConfig.testUrl/healthUrl.',
      );
    }

    const url = new URL(String(rawUrl));
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Provider test URL must use http or https');
    }

    const method = (
      this.firstString(config.testMethod, config.healthMethod, 'GET') ?? 'GET'
    ).toUpperCase();
    const headers = this.asRecord(config.testHeaders);
    const timeoutMs = Number(config.testTimeoutMs ?? config.timeoutMs ?? 10_000);

    return {
      url: url.toString(),
      method,
      headers,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000,
      expectedStatuses: this.expectedStatuses(config.expectedStatuses ?? config.expectedStatus),
    };
  }

  private expectedStatuses(value: unknown): Set<number> | null {
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    const statuses = values
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 100 && item <= 599);
    return statuses.length > 0 ? new Set(statuses) : null;
  }

  private isExpectedStatus(status: number, expectedStatuses: Set<number> | null): boolean {
    if (expectedStatuses) return expectedStatuses.has(status);
    return status >= 200 && status < 400;
  }

  private firstString(...values: unknown[]): string | undefined {
    return values.find((value): value is string => typeof value === 'string' && value.length > 0);
  }

  private asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};
  }

  private withTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private encryptJson(obj: Record<string, any>): string {
    return this.encryption.encrypt(JSON.stringify(obj));
  }
}
