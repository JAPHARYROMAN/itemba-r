import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateIntegrationProviderDto } from './dto/create-integration-provider.dto';
import { UpdateIntegrationProviderDto } from './dto/update-integration-provider.dto';
import { QueryIntegrationProviderDto } from './dto/query-integration-provider.dto';

@Injectable()
export class IntegrationProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: QueryIntegrationProviderDto) {
    const { page = 1, limit = 20, providerType, status, search } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    if (providerType) where.providerType = providerType;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { providerCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.integrationProvider.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.integrationProvider.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.integrationProvider.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Integration provider not found');
    return record;
  }

  async create(dto: CreateIntegrationProviderDto, userId: string) {
    const existing = await this.prisma.integrationProvider.findFirst({
      where: { providerCode: dto.providerCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException(`Provider code "${dto.providerCode}" already exists`);

    const record = await this.prisma.integrationProvider.create({ data: { ...dto } });

    await this.auditLogs.log({
      action: 'INTEGRATION_PROVIDER_CREATED',
      entityType: 'IntegrationProvider',
      entityId: record.id,
      userId,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async update(id: string, dto: UpdateIntegrationProviderDto, userId: string) {
    const existing = await this.findOneRaw(id);
    const record = await this.prisma.integrationProvider.update({ where: { id }, data: { ...dto } });

    await this.auditLogs.log({
      action: 'INTEGRATION_PROVIDER_UPDATED',
      entityType: 'IntegrationProvider',
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
    await this.prisma.integrationProvider.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'INTEGRATION_PROVIDER_DELETED',
      entityType: 'IntegrationProvider',
      entityId: id,
      userId,
      oldValue: existing as any,
      severity: AuditSeverity.MEDIUM,
    });

    return { success: true };
  }

  private async findOneRaw(id: string) {
    const record = await this.prisma.integrationProvider.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Integration provider not found');
    return record;
  }
}
