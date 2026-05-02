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
    if (existing) throw new BadRequestException(`Connection code "${dto.connectionCode}" already exists`);

    const credentialsEncrypted = dto.credentials
      ? this.encryptJson(dto.credentials)
      : undefined;
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

    const credentialsEncrypted = dto.credentials
      ? this.encryptJson(dto.credentials)
      : undefined;
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
        ...(credentialsEncrypted !== undefined && { credentialsEncrypted: credentialsEncrypted as any }),
        ...(privateConfigEncrypted !== undefined && { privateConfigEncrypted: privateConfigEncrypted as any }),
        ...(dto.companyId !== undefined && { companyId: dto.companyId }),
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.licensedBusinessUnitId !== undefined && { licensedBusinessUnitId: dto.licensedBusinessUnitId }),
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
    await this.prisma.integrationConnection.update({ where: { id }, data: { deletedAt: new Date() } });

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
    await this.findOneRaw(id);
    // In a real implementation, this would call the provider's test endpoint
    const record = await this.prisma.integrationConnection.update({
      where: { id },
      data: {
        lastTestedAt: new Date(),
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
    });

    return record;
  }

  private async findOneRaw(id: string) {
    const record = await this.prisma.integrationConnection.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Integration connection not found');
    return record;
  }

  private encryptJson(obj: Record<string, any>): string {
    return this.encryption.encrypt(JSON.stringify(obj));
  }
}
