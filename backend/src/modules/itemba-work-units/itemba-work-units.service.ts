import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateItembaWorkUnitDto } from './dto/create-itemba-work-unit.dto';
import { UpdateItembaWorkUnitDto } from './dto/update-itemba-work-unit.dto';

@Injectable()
export class ItembaWorkUnitsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateItembaWorkUnitDto, userId: string) {
    const existing = await this.prisma.itembaWorkUnit.findFirst({
      where: { companyId: dto.companyId, workUnitCode: dto.workUnitCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Work unit code already exists for this company');

    const unit = await this.prisma.itembaWorkUnit.create({
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'ItembaWorkUnit', entityId: unit.id, newValue: dto as unknown as Record<string, unknown> });
    return unit;
  }

  async findAll(companyId?: string, divisionId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (divisionId) where.divisionId = divisionId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.itembaWorkUnit.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { company: { select: { name: true } }, division: { select: { name: true } } } }),
      this.prisma.itembaWorkUnit.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const unit = await this.prisma.itembaWorkUnit.findFirst({ where: { id, deletedAt: null }, include: { company: { select: { name: true } }, division: { select: { name: true } }, branch: { select: { name: true } }, manager: { select: { fullName: true } } } });
    if (!unit) throw new NotFoundException('Work unit not found');
    return unit;
  }

  async update(id: string, dto: UpdateItembaWorkUnitDto, userId: string) {
    await this.findOne(id);
    const unit = await this.prisma.itembaWorkUnit.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'ItembaWorkUnit', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return unit;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.itembaWorkUnit.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'ItembaWorkUnit', entityId: id, newValue: {} });
    return { message: 'Work unit deleted' };
  }
}
