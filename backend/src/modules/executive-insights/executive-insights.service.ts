import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, InsightStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateExecutiveInsightDto } from './dto/create-executive-insight.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';

@Injectable()
export class ExecutiveInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, insightType, severity, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (insightType) where.insightType = insightType;
    if (severity) where.severity = severity;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.executiveInsight.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.executiveInsight.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.executiveInsight.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Executive Insight not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async create(dto: CreateExecutiveInsightDto, user: AuthUser) {
    const companyId = dto.companyId ?? (this.companyScope.isGroupScoped(user) ? undefined : user.companyId);
    await this.companyScope.assertCanAccessCompany(user, companyId ?? null, AccessLevel.WRITE);
    const record = await this.prisma.executiveInsight.create({
      data: {
        ...dto,
        companyId: companyId ?? null,
        insightNumber: `INS-${Date.now()}`,
        createdById: user.id,
        insightDate: new Date(dto.insightDate),
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ExecutiveInsight', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: Partial<CreateExecutiveInsightDto>, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId ?? null, AccessLevel.WRITE);
    }
    const updateData: any = { ...dto };
    if (dto.insightDate) updateData.insightDate = new Date(dto.insightDate);
    const record = await this.prisma.executiveInsight.update({ where: { id }, data: updateData });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ExecutiveInsight', entityId: record.id, newValue: dto as any });
    return record;
  }

  async acknowledge(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.executiveInsight.update({
      where: { id },
      data: { acknowledgedById: user.id, acknowledgedAt: new Date(), status: InsightStatus.ACKNOWLEDGED },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ExecutiveInsight', entityId: id, newValue: { status: 'ACKNOWLEDGED' } as any });
    return record;
  }

  async resolve(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.executiveInsight.update({
      where: { id },
      data: { resolvedById: user.id, resolvedAt: new Date(), status: InsightStatus.RESOLVED },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ExecutiveInsight', entityId: id, newValue: { status: 'RESOLVED' } as any });
    return record;
  }

  async dismiss(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.executiveInsight.update({ where: { id }, data: { status: InsightStatus.DISMISSED } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ExecutiveInsight', entityId: id, newValue: { status: 'DISMISSED' } as any });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user, AccessLevel.WRITE);
    const record = await this.prisma.executiveInsight.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ExecutiveInsight', entityId: id, newValue: {} as any });
    return record;
  }
}
