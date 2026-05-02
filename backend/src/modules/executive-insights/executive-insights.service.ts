import { Injectable, NotFoundException } from '@nestjs/common';
import { InsightStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateExecutiveInsightDto } from './dto/create-executive-insight.dto';

@Injectable()
export class ExecutiveInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, insightType, severity, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    else if (user.companyId) where.companyId = user.companyId;
    if (insightType) where.insightType = insightType;
    if (severity) where.severity = severity;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.executiveInsight.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.executiveInsight.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.executiveInsight.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Executive Insight not found');
    return record;
  }

  async create(dto: CreateExecutiveInsightDto, user: any) {
    const record = await this.prisma.executiveInsight.create({
      data: {
        ...dto,
        insightNumber: `INS-${Date.now()}`,
        createdById: user.id,
        insightDate: new Date(dto.insightDate),
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ExecutiveInsight', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: Partial<CreateExecutiveInsightDto>, user: any) {
    await this.findOne(id, user);
    const updateData: any = { ...dto };
    if (dto.insightDate) updateData.insightDate = new Date(dto.insightDate);
    const record = await this.prisma.executiveInsight.update({ where: { id }, data: updateData });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ExecutiveInsight', entityId: record.id, newValue: dto as any });
    return record;
  }

  async acknowledge(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.executiveInsight.update({
      where: { id },
      data: { acknowledgedById: user.id, acknowledgedAt: new Date(), status: InsightStatus.ACKNOWLEDGED },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ExecutiveInsight', entityId: id, newValue: { status: 'ACKNOWLEDGED' } as any });
    return record;
  }

  async resolve(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.executiveInsight.update({
      where: { id },
      data: { resolvedById: user.id, resolvedAt: new Date(), status: InsightStatus.RESOLVED },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ExecutiveInsight', entityId: id, newValue: { status: 'RESOLVED' } as any });
    return record;
  }

  async dismiss(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.executiveInsight.update({ where: { id }, data: { status: InsightStatus.DISMISSED } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ExecutiveInsight', entityId: id, newValue: { status: 'DISMISSED' } as any });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.executiveInsight.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ExecutiveInsight', entityId: id, newValue: {} as any });
    return record;
  }
}
