import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateReportDefinitionDto } from './dto/create-report-definition.dto';
import { UpdateReportDefinitionDto } from './dto/update-report-definition.dto';

@Injectable()
export class ReportDefinitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, reportCategory, isActive, isSensitive, search } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (reportCategory) where.reportCategory = reportCategory;
    if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;
    if (isSensitive !== undefined) where.isSensitive = isSensitive === 'true' || isSensitive === true;
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      this.prisma.reportDefinition.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.reportDefinition.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.reportDefinition.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Report Definition not found');
    return record;
  }

  async create(dto: CreateReportDefinitionDto, user: any) {
    const record = await this.prisma.reportDefinition.create({ data: { ...dto, createdById: user.id } });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ReportDefinition', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: UpdateReportDefinitionDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.reportDefinition.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ReportDefinition', entityId: record.id, newValue: dto as any });
    return record;
  }

  async activate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.reportDefinition.update({ where: { id }, data: { isActive: true } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ReportDefinition', entityId: id, newValue: { isActive: true } as any });
    return record;
  }

  async deactivate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.reportDefinition.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ReportDefinition', entityId: id, newValue: { isActive: false } as any });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.reportDefinition.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ReportDefinition', entityId: id, newValue: {} as any });
    return record;
  }
}
