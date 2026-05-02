import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateSalesChannelDto } from './dto/create-sales-channel.dto';
import { UpdateSalesChannelDto } from './dto/update-sales-channel.dto';
import { QuerySalesChannelDto } from './dto/query-sales-channel.dto';

@Injectable()
export class SalesChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreateSalesChannelDto, userId: string) {
    const record = await this.prisma.salesChannel.create({
      data: {
        companyId: dto.companyId,
        branchId: dto.branchId,
        name: dto.name,
        channelType: dto.channelType,
        isActive: dto.isActive ?? true,
      },
    });
    await this.auditLogs.log({
      action: 'SALES_CHANNEL_CREATE',
      entityType: 'SalesChannel',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async findAll(query: QuerySalesChannelDto) {
    const { page = 1, limit = 20, companyId, branchId, channelType, isActive } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (branchId) where.branchId = branchId;
    if (channelType) where.channelType = channelType;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.salesChannel.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.salesChannel.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const record = await this.prisma.salesChannel.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Sales channel not found');
    return record;
  }

  async update(id: string, dto: UpdateSalesChannelDto, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.salesChannel.update({
      where: { id },
      data: {
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.name && { name: dto.name }),
        ...(dto.channelType && { channelType: dto.channelType }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    await this.auditLogs.log({
      action: 'SALES_CHANNEL_UPDATE',
      entityType: 'SalesChannel',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.salesChannel.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'SALES_CHANNEL_DELETE',
      entityType: 'SalesChannel',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });
    return { success: true };
  }
}
