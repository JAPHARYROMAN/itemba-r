import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateFarmDto } from './dto/create-farm.dto';
import { UpdateFarmDto } from './dto/update-farm.dto';

@Injectable()
export class FarmsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateFarmDto, userId: string) {
    const existing = await this.prisma.farm.findFirst({ where: { companyId: dto.companyId, farmCode: dto.farmCode, deletedAt: null } });
    if (existing) throw new BadRequestException('Farm code already exists');
    const farm = await this.prisma.farm.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'Farm', entityId: farm.id, newValue: dto as unknown as Record<string, unknown> });
    return farm;
  }

  async findAll(companyId?: string, divisionId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (divisionId) where.divisionId = divisionId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.farm.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { company: { select: { name: true } }, division: { select: { name: true } }, sizeUnit: { select: { symbol: true } }, manager: { select: { fullName: true } } } }),
      this.prisma.farm.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const farm = await this.prisma.farm.findFirst({ where: { id, deletedAt: null }, include: { company: { select: { name: true } }, division: { select: { name: true } }, sizeUnit: { select: { name: true, symbol: true } }, manager: { select: { fullName: true } }, fixedAsset: { select: { name: true, assetCode: true } } } });
    if (!farm) throw new NotFoundException('Farm not found');
    return farm;
  }

  async update(id: string, dto: UpdateFarmDto, userId: string) {
    await this.findOne(id);
    const farm = await this.prisma.farm.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'Farm', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return farm;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.farm.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'Farm', entityId: id, newValue: {} });
    return { message: 'Farm deleted' };
  }
}
