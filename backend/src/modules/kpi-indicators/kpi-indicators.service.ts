import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateKpiIndicatorDto } from './dto/create-kpi-indicator.dto';
import { UpdateKpiIndicatorDto } from './dto/update-kpi-indicator.dto';

@Injectable()
export class KpiIndicatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, category, isActive, search } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (category) where.kpiCategory = category;
    if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      this.prisma.kPIIndicator.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.kPIIndicator.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.kPIIndicator.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('KPI Indicator not found');
    return record;
  }

  async create(dto: CreateKpiIndicatorDto, user: any) {
    const record = await this.prisma.kPIIndicator.create({ data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'KPIIndicator', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: UpdateKpiIndicatorDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.kPIIndicator.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'KPIIndicator', entityId: record.id, newValue: dto as any });
    return record;
  }

  async activate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.kPIIndicator.update({ where: { id }, data: { isActive: true } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'KPIIndicator', entityId: id, newValue: { isActive: true } as any });
    return record;
  }

  async deactivate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.kPIIndicator.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'KPIIndicator', entityId: id, newValue: { isActive: false } as any });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.kPIIndicator.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'KPIIndicator', entityId: id, newValue: {} as any });
    return record;
  }
}
