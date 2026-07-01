import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateIntegrationMappingDto } from './dto/create-integration-mapping.dto';
import { UpdateIntegrationMappingDto } from './dto/update-integration-mapping.dto';
import { QueryIntegrationMappingDto } from './dto/query-integration-mapping.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';

@Injectable()
export class IntegrationMappingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryIntegrationMappingDto, user: AuthUser) {
    const { page = 1, limit = 20, companyId, providerId, connectionId, internalEntityType, externalEntityType, status } = query;
    const skip = (page - 1) * limit;
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (providerId) where.providerId = providerId;
    if (connectionId) where.connectionId = connectionId;
    if (internalEntityType) where.internalEntityType = internalEntityType;
    if (externalEntityType) where.externalEntityType = externalEntityType;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.integrationMapping.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.integrationMapping.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.integrationMapping.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Integration mapping not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.READ);
    return record;
  }

  async create(dto: CreateIntegrationMappingDto, user: AuthUser) {
    const userId = user.id;
    // NEVER trust a client-supplied companyId for authorization: validate it
    // against the user's WRITE access before writing the record.
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    const existing = await this.prisma.integrationMapping.findFirst({
      where: { mappingCode: dto.mappingCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException(`Mapping code "${dto.mappingCode}" already exists`);

    const record = await this.prisma.integrationMapping.create({
      data: {
        mappingCode: dto.mappingCode,
        companyId: dto.companyId,
        providerId: dto.providerId,
        connectionId: dto.connectionId,
        internalEntityType: dto.internalEntityType,
        externalEntityType: dto.externalEntityType,
        internalEntityId: dto.internalEntityId,
        externalEntityId: dto.externalEntityId,
        mappingData: dto.mappingData as any,
        status: dto.status,
      },
    });

    await this.auditLogs.log({
      action: 'INTEGRATION_MAPPING_CREATED',
      entityType: 'IntegrationMapping',
      entityId: record.id,
      userId,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async update(id: string, dto: UpdateIntegrationMappingDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOneRaw(id, user, AccessLevel.WRITE);
    // companyId is immutable: reject any attempt to re-scope the mapping to a
    // different company (prevents cross-tenant reassignment via mass-assignment).
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      throw new BadRequestException('companyId cannot be changed');
    }
    const record = await this.prisma.integrationMapping.update({
      where: { id },
      data: {
        ...(dto.internalEntityType !== undefined && { internalEntityType: dto.internalEntityType }),
        ...(dto.externalEntityType !== undefined && { externalEntityType: dto.externalEntityType }),
        ...(dto.internalEntityId !== undefined && { internalEntityId: dto.internalEntityId }),
        ...(dto.externalEntityId !== undefined && { externalEntityId: dto.externalEntityId }),
        ...(dto.mappingData !== undefined && { mappingData: dto.mappingData as any }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.providerId !== undefined && { providerId: dto.providerId }),
        ...(dto.connectionId !== undefined && { connectionId: dto.connectionId }),
      },
    });

    await this.auditLogs.log({
      action: 'INTEGRATION_MAPPING_UPDATED',
      entityType: 'IntegrationMapping',
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
    await this.prisma.integrationMapping.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'INTEGRATION_MAPPING_DELETED',
      entityType: 'IntegrationMapping',
      entityId: id,
      userId,
      oldValue: existing as any,
      severity: AuditSeverity.MEDIUM,
    });

    return { success: true };
  }

  private async findOneRaw(
    id: string,
    user?: AuthUser,
    minimum: AccessLevel = AccessLevel.READ,
  ) {
    const record = await this.prisma.integrationMapping.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Integration mapping not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }
    return record;
  }
}
