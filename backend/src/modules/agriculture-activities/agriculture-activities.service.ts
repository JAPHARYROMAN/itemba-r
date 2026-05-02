import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateAgricultureActivityDto } from './dto/create-agriculture-activity.dto';
import { UpdateAgricultureActivityDto } from './dto/update-agriculture-activity.dto';

@Injectable()
export class AgricultureActivitiesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private codes: EntityCodeGeneratorService,
  ) {}

  async create(dto: CreateAgricultureActivityDto, userId: string) {
    const activityNumber = await this.codes.next({ entityType: 'AgricultureActivity', companyId: dto.companyId });
    const activity = await this.prisma.agricultureActivity.create({
      data: { ...dto, activityNumber, activityDate: new Date(dto.activityDate), createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'AgricultureActivity', entityId: activity.id, newValue: dto as unknown as Record<string, unknown> });
    return activity;
  }

  async findAll(farmId?: string, cropSeasonId?: string, companyId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (farmId) where.farmId = farmId;
    if (cropSeasonId) where.cropSeasonId = cropSeasonId;
    if (companyId) where.companyId = companyId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.agricultureActivity.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { activityDate: 'desc' } }),
      this.prisma.agricultureActivity.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const a = await this.prisma.agricultureActivity.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw new NotFoundException('Agriculture activity not found');
    return a;
  }

  async update(id: string, dto: UpdateAgricultureActivityDto, userId: string) {
    await this.findOne(id);
    const activity = await this.prisma.agricultureActivity.update({ where: { id }, data: { ...dto, activityDate: dto.activityDate ? new Date(dto.activityDate) : undefined } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'AgricultureActivity', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return activity;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.agricultureActivity.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'AgricultureActivity', entityId: id, newValue: {} });
    return { message: 'Activity deleted' };
  }
}
