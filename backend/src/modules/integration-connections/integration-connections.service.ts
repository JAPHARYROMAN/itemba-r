import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as dns from 'dns';
import * as net from 'net';
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
    // SSRF guard: reject private/loopback/link-local/metadata targets before
    // any network request is made.
    await this.assertPublicUrl(probe.url);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), probe.timeoutMs);

    try {
      const response = await fetch(probe.url, {
        method: probe.method,
        headers: probe.headers,
        signal: controller.signal,
        // Do not follow redirects — a 3xx could otherwise bypass the SSRF
        // pre-flight check and reach an internal target.
        redirect: 'error',
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

  /**
   * SSRF guard. Rejects URLs whose host (literal IP, or any DNS-resolved
   * address) falls in a private, loopback, link-local, unspecified or
   * cloud-metadata range. Throws on rejection or DNS failure.
   */
  private async assertPublicUrl(rawUrl: string): Promise<void> {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^\[|\]$/g, '');

    if (net.isIP(host)) {
      if (!this.isPublicIp(host)) {
        throw new Error('Refusing to probe a non-public address');
      }
      return;
    }

    let addresses: Array<{ address: string }>;
    try {
      addresses = await dns.promises.lookup(host, { all: true });
    } catch {
      throw new Error(`Unable to resolve host ${host}`);
    }
    if (addresses.length === 0) {
      throw new Error(`Unable to resolve host ${host}`);
    }
    for (const { address } of addresses) {
      if (!this.isPublicIp(address)) {
        throw new Error('Refusing to probe a non-public address');
      }
    }
  }

  /** Returns true only if the literal IP is a routable, non-internal address. */
  private isPublicIp(ip: string): boolean {
    const version = net.isIP(ip);
    if (version === 4) return this.isPublicIpv4(ip);
    if (version === 6) return this.isPublicIpv6(ip);
    return false;
  }

  private isPublicIpv4(ip: string): boolean {
    const parts = ip.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return false;
    }
    const [a, b] = parts;
    if (a === 0) return false; // 0.0.0.0/8 (unspecified / "this network")
    if (a === 10) return false; // 10.0.0.0/8 private
    if (a === 127) return false; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local (incl. 169.254.169.254 metadata)
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return false; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 carrier-grade NAT
    if (a === 192 && b === 0) return false; // 192.0.0.0/24 IETF, 192.0.2.0/24 TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 benchmarking
    if (a >= 224) return false; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    return true;
  }

  private isPublicIpv6(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return false; // unspecified / loopback
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
    const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return this.isPublicIpv4(mapped[1]);
    if (lower.startsWith('fe80')) return false; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return false; // unique local fc00::/7
    if (lower.startsWith('ff')) return false; // multicast
    return true;
  }

  private encryptJson(obj: Record<string, any>): string {
    return this.encryption.encrypt(JSON.stringify(obj));
  }
}
