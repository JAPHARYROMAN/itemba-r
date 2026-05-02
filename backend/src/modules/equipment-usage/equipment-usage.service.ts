import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateEquipmentUsageDto } from './dto/create-equipment-usage.dto';
import { UpdateEquipmentUsageDto } from './dto/update-equipment-usage.dto';

@Injectable()
export class EquipmentUsageService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private codes: EntityCodeGeneratorService,
  ) {}

  async create(dto: CreateEquipmentUsageDto, userId: string) {
    const usageNumber = await this.codes.next({ entityType: 'EquipmentUsage', companyId: dto.companyId });
    const usage = await this.prisma.equipmentUsage.create({
      data: { ...dto, usageNumber, usageDate: new Date(dto.usageDate), createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'EquipmentUsage', entityId: usage.id, newValue: dto as unknown as Record<string, unknown> });
    return usage;
  }

  async findAll(companyId?: string, divisionId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (divisionId) where.divisionId = divisionId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.equipmentUsage.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { usageDate: 'desc' }, include: { company: { select: { name: true } }, division: { select: { name: true } }, fixedAsset: { select: { name: true } } } }),
      this.prisma.equipmentUsage.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const usage = await this.prisma.equipmentUsage.findFirst({ where: { id, deletedAt: null } });
    if (!usage) throw new NotFoundException('Equipment usage not found');
    return usage;
  }

  async update(id: string, dto: UpdateEquipmentUsageDto, userId: string) {
    await this.findOne(id);
    const usage = await this.prisma.equipmentUsage.update({
      where: { id },
      data: { ...dto, usageDate: dto.usageDate ? new Date(dto.usageDate) : undefined },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'EquipmentUsage', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return usage;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.equipmentUsage.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'EquipmentUsage', entityId: id, newValue: {} });
    return { message: 'Equipment usage deleted' };
  }
}
