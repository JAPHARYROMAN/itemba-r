import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateCropDto } from './dto/create-crop.dto';
import { UpdateCropDto } from './dto/update-crop.dto';

@Injectable()
export class CropsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateCropDto, userId: string) {
    const existing = await this.prisma.crop.findFirst({ where: { companyId: dto.companyId, cropCode: dto.cropCode, deletedAt: null } });
    if (existing) throw new BadRequestException('Crop code already exists');
    const crop = await this.prisma.crop.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'Crop', entityId: crop.id, newValue: dto as unknown as Record<string, unknown> });
    return crop;
  }

  async findAll(companyId?: string, page = 1, limit = 50) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.crop.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: 'asc' } }),
      this.prisma.crop.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const crop = await this.prisma.crop.findFirst({ where: { id, deletedAt: null } });
    if (!crop) throw new NotFoundException('Crop not found');
    return crop;
  }

  async update(id: string, dto: UpdateCropDto, userId: string) {
    await this.findOne(id);
    const crop = await this.prisma.crop.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'Crop', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return crop;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.crop.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'Crop', entityId: id, newValue: {} });
    return { message: 'Crop deleted' };
  }
}
