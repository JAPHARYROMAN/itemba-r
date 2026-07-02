import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as dns from 'dns';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { AccessLevel, AuditSeverity, IntegrationConnectionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateIntegrationConnectionDto } from './dto/create-integration-connection.dto';
import { UpdateIntegrationConnectionDto } from './dto/update-integration-connection.dto';
import { QueryIntegrationConnectionDto } from './dto/query-integration-connection.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  CompanyScopeService,
  EncryptionService,
  applyCompanyScopeWhere,
} from '../../common/services';

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
    private readonly companyScope: CompanyScopeService,
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

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.integrationConnection.findFirst({
      where: { id, deletedAt: null },
      select: SAFE_SELECT,
    });
    if (!record) throw new NotFoundException('Integration connection not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.READ);
    return record;
  }

  async create(dto: CreateIntegrationConnectionDto, user: AuthUser) {
    const userId = user.id;
    // Validate the client-supplied companyId against the caller's access before
    // trusting it. Never let a client create a connection under a company they
    // cannot write to.
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

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

  async update(id: string, dto: UpdateIntegrationConnectionDto, user: AuthUser) {
    const userId = user.id;
    // Loads the row and asserts WRITE access on its owning company.
    const existing = await this.findOneRaw(id, user, AccessLevel.WRITE);

    // companyId is immutable: reassigning a connection to another company would
    // move credentials/config across the tenant boundary. Reject any attempt to
    // change it (a no-op re-send of the same value is allowed).
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      throw new BadRequestException('companyId cannot be changed on an integration connection');
    }

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

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    await this.findOneRaw(id, user, AccessLevel.WRITE);
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

  async testConnection(id: string, user: AuthUser) {
    const userId = user.id;
    const connection = await this.findOneWithProvider(id, user);
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

  private async findOneRaw(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.integrationConnection.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Integration connection not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }
    return record;
  }

  private async findOneWithProvider(
    id: string,
    user?: AuthUser,
    minimum: AccessLevel = AccessLevel.WRITE,
  ) {
    const record = await this.prisma.integrationConnection.findFirst({
      where: { id, deletedAt: null },
      include: {
        provider: { select: { id: true, providerCode: true, name: true, baseUrl: true } },
      },
    });
    if (!record) throw new NotFoundException('Integration connection not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }
    return record;
  }

  private async probeConnection(connection: Awaited<ReturnType<typeof this.findOneWithProvider>>) {
    const config = this.asRecord(connection.publicConfig);
    const probe = this.resolveProbeTarget(connection, config);
    // SSRF guard: resolve the host once, assert every resolved address is
    // public, and PIN a vetted IP for the actual request. The request below
    // connects only to that pinned address (never re-resolving the hostname),
    // which closes the DNS-rebinding TOCTOU: a host that passed validation
    // cannot resolve to a private/metadata address at connect time.
    const pinnedIp = await this.resolvePinnedPublicIp(probe.url);
    const startedAt = Date.now();

    const response = await this.performPinnedRequest(probe, pinnedIp);
    const durationMs = Date.now() - startedAt;
    // Reject redirects instead of following them: a 3xx could otherwise point
    // at an internal target that never went through the pre-flight SSRF check.
    // (Only treat as a redirect-failure when the caller did not explicitly
    // whitelist this status.)
    if (
      response.status >= 300 &&
      response.status < 400 &&
      !(probe.expectedStatuses && probe.expectedStatuses.has(response.status))
    ) {
      throw new Error(
        `Refusing to follow redirect (HTTP ${response.status}) from ${probe.url}`,
      );
    }
    if (!this.isExpectedStatus(response.status, probe.expectedStatuses)) {
      throw new Error(
        `HTTP ${response.status} from ${probe.url}${
          response.body ? `: ${response.body.slice(0, 200)}` : ''
        }`,
      );
    }
    return {
      url: probe.url,
      method: probe.method,
      status: response.status,
      durationMs,
    };
  }

  /**
   * Performs the probe request against a PINNED IP address. The request never
   * re-resolves the hostname: a custom `lookup` always returns `pinnedIp`, so
   * the socket connects to exactly the address that `resolvePinnedPublicIp`
   * validated. TLS SNI / certificate verification still use the original
   * hostname via `servername`. Redirects are NOT followed (a 3xx could
   * otherwise reach an internal target that bypassed the pre-flight check).
   */
  private performPinnedRequest(
    probe: {
      url: string;
      method: string;
      headers: Record<string, any>;
      timeoutMs: number;
    },
    pinnedIp: string,
  ): Promise<{ status: number; body: string }> {
    const target = new URL(probe.url);
    const isHttps = target.protocol === 'https:';
    const transport = this.httpTransport(isHttps);
    const family = net.isIP(pinnedIp);

    // Force every connection attempt for this request onto the vetted IP.
    const lookup: net.LookupFunction = (_hostname, _options, callback) => {
      // Signature tolerates both (err, address, family) and (err, addresses).
      (callback as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(
        null,
        pinnedIp,
        family,
      );
    };

    const options: https.RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: probe.method,
      headers: { host: target.host, ...probe.headers },
      timeout: probe.timeoutMs,
      lookup,
      // Preserve TLS SNI + certificate hostname verification against the
      // original hostname even though we connect to the pinned IP.
      ...(isHttps ? { servername: target.hostname } : {}),
    };

    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        const status = res.statusCode ?? 0;
        // Do not follow redirects; capture a small body snippet for diagnostics.
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          if (bytes < 4096) {
            chunks.push(chunk);
            bytes += chunk.length;
          }
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').slice(0, 2000);
          resolve({ status, body });
        });
        res.on('error', reject);
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Timed out after ${probe.timeoutMs}ms probing ${probe.url}`));
      });
      req.on('error', reject);
      req.end();
    });
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
   * Returns the Node transport module for the probe. Extracted into a seam so
   * tests can substitute a stub without mutating the frozen `http`/`https`
   * namespace objects.
   */
  private httpTransport(isHttps: boolean): {
    request: typeof https.request | typeof http.request;
  } {
    return isHttps ? https : http;
  }

  /**
   * SSRF guard. Resolves the URL's host (or accepts a literal IP), asserts that
   * EVERY resolved address is a routable public address, and returns a single
   * vetted IP to pin the outbound connection to. Rejecting requires all
   * addresses to be public so a mixed public/private answer cannot be exploited
   * by picking the public one. Throws on rejection or DNS failure.
   *
   * The returned IP is the address the request MUST connect to; because the
   * request pins this IP (see performPinnedRequest) rather than re-resolving
   * the hostname, a DNS-rebind between validation and connect is impossible.
   */
  private async resolvePinnedPublicIp(rawUrl: string): Promise<string> {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^\[|\]$/g, '');

    if (net.isIP(host)) {
      if (!this.isPublicIp(host)) {
        throw new Error('Refusing to probe a non-public address');
      }
      return host;
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
    // Every resolved address passed validation; pin the first one for the
    // actual request so the socket cannot reach a re-resolved private target.
    return addresses[0].address;
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
