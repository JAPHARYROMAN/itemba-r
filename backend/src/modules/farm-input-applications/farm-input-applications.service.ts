import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateFarmInputApplicationDto } from './dto/create-farm-input-application.dto';
import { UpdateFarmInputApplicationDto } from './dto/update-farm-input-application.dto';

@Injectable()
export class FarmInputApplicationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private codes: EntityCodeGeneratorService,
  ) {}

  async create(dto: CreateFarmInputApplicationDto, userId: string) {
    const applicationNumber = await this.codes.next({ entityType: 'FarmInputApplication', companyId: dto.companyId });
    const application = await this.prisma.farmInputApplication.create({
      data: { ...dto, applicationNumber, applicationDate: new Date(dto.applicationDate), createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'FarmInputApplication', entityId: application.id, newValue: dto as unknown as Record<string, unknown> });
    return application;
  }

  async findAll(cropSeasonId?: string, farmId?: string, companyId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (cropSeasonId) where.cropSeasonId = cropSeasonId;
    if (farmId) where.farmId = farmId;
    if (companyId) where.companyId = companyId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.farmInputApplication.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { applicationDate: 'desc' }, include: { product: { select: { name: true, sku: true } }, unit: { select: { symbol: true } } } }),
      this.prisma.farmInputApplication.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const app = await this.prisma.farmInputApplication.findFirst({ where: { id, deletedAt: null } });
    if (!app) throw new NotFoundException('Farm input application not found');
    return app;
  }

  async update(id: string, dto: UpdateFarmInputApplicationDto, userId: string) {
    await this.findOne(id);
    const app = await this.prisma.farmInputApplication.update({ where: { id }, data: { ...dto, applicationDate: dto.applicationDate ? new Date(dto.applicationDate) : undefined } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'FarmInputApplication', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return app;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.farmInputApplication.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'FarmInputApplication', entityId: id, newValue: {} });
    return { message: 'Farm input application deleted' };
  }
}
