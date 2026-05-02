import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateCropSeasonDto } from './dto/create-crop-season.dto';
import { UpdateCropSeasonDto } from './dto/update-crop-season.dto';
import { CropSeasonStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class CropSeasonsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateCropSeasonDto, userId: string) {
    const existing = await this.prisma.cropSeason.findFirst({ where: { companyId: dto.companyId, seasonCode: dto.seasonCode, deletedAt: null } });
    if (existing) throw new BadRequestException('Season code already exists');
    const season = await this.prisma.cropSeason.create({
      data: { ...dto, plantingDate: dto.plantingDate ? new Date(dto.plantingDate) : undefined, expectedHarvestDate: dto.expectedHarvestDate ? new Date(dto.expectedHarvestDate) : undefined, createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'CropSeason', entityId: season.id, newValue: dto as unknown as Record<string, unknown> });
    return season;
  }

  async findAll(farmId?: string, companyId?: string, status?: CropSeasonStatus, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    if (farmId) where.farmId = farmId;
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.cropSeason.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { farm: { select: { name: true } }, field: { select: { name: true } }, crop: { select: { name: true, cropType: true } } } }),
      this.prisma.cropSeason.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const season = await this.prisma.cropSeason.findFirst({ where: { id, deletedAt: null }, include: { farm: true, field: true, crop: true, yieldUnit: { select: { name: true, symbol: true } } } });
    if (!season) throw new NotFoundException('Crop season not found');
    return season;
  }

  async updateStatus(id: string, status: CropSeasonStatus, userId: string) {
    await this.findOne(id);
    const season = await this.prisma.cropSeason.update({ where: { id }, data: { status, actualHarvestDate: status === CropSeasonStatus.HARVESTED ? new Date() : undefined } });
    await this.audit.log({ userId, action: 'STATUS_CHANGE', entityType: 'CropSeason', entityId: id, newValue: { status } });
    return season;
  }

  async update(id: string, dto: UpdateCropSeasonDto, userId: string) {
    await this.findOne(id);
    const season = await this.prisma.cropSeason.update({ where: { id }, data: { ...dto, plantingDate: dto.plantingDate ? new Date(dto.plantingDate) : undefined, expectedHarvestDate: dto.expectedHarvestDate ? new Date(dto.expectedHarvestDate) : undefined } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'CropSeason', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return season;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.cropSeason.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'CropSeason', entityId: id, newValue: {} });
    return { message: 'Crop season deleted' };
  }
}
