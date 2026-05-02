import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class LaunchAssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: any, userId: string) {
    const record = await this.prisma.launchReadinessAssessment.create({
      data: {
        assessmentNumber: `LRA-${Date.now()}`,
        environment: dto.environment ?? 'STAGING',
        assessmentDate: dto.assessmentDate ? new Date(dto.assessmentDate) : new Date(),
        status: 'DRAFT',
        assessedById: userId,
        summary: dto.summary,
        recommendations: dto.recommendations,
        risks: dto.risks,
      },
    });
    await this.auditLogs.log({ action: 'LAUNCH_ASSESSMENT_CREATED', entityType: 'LaunchReadinessAssessment', entityId: record.id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, status, environment } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (environment) where.environment = environment;
    const [data, total] = await Promise.all([
      this.prisma.launchReadinessAssessment.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }),
      this.prisma.launchReadinessAssessment.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.launchReadinessAssessment.findFirst({
      where: { id, deletedAt: null },
      include: { readinessItems: true },
    });
    if (!record) throw new NotFoundException('Launch assessment not found');
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.launchReadinessAssessment.update({
      where: { id },
      data: {
        ...(dto.summary !== undefined && { summary: dto.summary }),
        ...(dto.recommendations !== undefined && { recommendations: dto.recommendations }),
        ...(dto.risks !== undefined && { risks: dto.risks }),
      },
    });
    await this.auditLogs.log({ action: 'LAUNCH_ASSESSMENT_UPDATED', entityType: 'LaunchReadinessAssessment', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.launchReadinessAssessment.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: `LAUNCH_ASSESSMENT_${status}`, entityType: 'LaunchReadinessAssessment', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async calculate(id: string, userId: string) {
    const [openCritical, openTotal] = await Promise.all([
      this.prisma.launchBlocker.count({ where: { status: 'OPEN', severity: 'CRITICAL', deletedAt: null } }),
      this.prisma.launchBlocker.count({ where: { status: 'OPEN', deletedAt: null } }),
    ]);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totalResults, passedResults, publishedDocs] = await Promise.all([
      this.prisma.qATestResult.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.qATestResult.count({ where: { status: 'PASSED', createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.userManual.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
    ]);

    const qaScore = totalResults > 0 ? Math.round((passedResults / totalResults) * 100) : 0;
    const blockerScore = openCritical > 0 ? 0 : Math.max(0, 100 - openTotal * 5);
    const docScore = Math.min(100, publishedDocs * 10);
    const overallScore = Math.round((qaScore + blockerScore + docScore) / 3);

    let status: string;
    if (openCritical > 0) status = 'NOT_READY';
    else if (openTotal > 0 || overallScore < 70) status = 'READY_WITH_RISKS';
    else status = 'READY';

    const record = await this.prisma.launchReadinessAssessment.update({
      where: { id },
      data: { status: status as any, overallScore, qaScore, securityScore: blockerScore, documentationScore: docScore },
    });
    await this.auditLogs.log({ action: 'LAUNCH_ASSESSMENT_CALCULATED', entityType: 'LaunchReadinessAssessment', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async approve(id: string, userId: string) {
    const record = await this.findOne(id);
    if (record.status !== 'READY' && record.status !== 'READY_WITH_RISKS') {
      throw new BadRequestException('Assessment must be READY or READY_WITH_RISKS to approve');
    }
    const updated = await this.prisma.launchReadinessAssessment.update({
      where: { id },
      data: { approvedById: userId, approvedAt: new Date() },
    });
    await this.auditLogs.log({ action: 'LAUNCH_ASSESSMENT_APPROVED', entityType: 'LaunchReadinessAssessment', entityId: id, userId, severity: AuditSeverity.HIGH });
    return updated;
  }

  async addItem(assessmentId: string, dto: any, userId: string) {
    await this.findOne(assessmentId);
    const item = await this.prisma.launchReadinessItem.create({
      data: {
        assessmentId,
        category: dto.category,
        title: dto.title,
        description: dto.description,
        status: dto.status ?? 'NOT_STARTED',
        responsibleUserId: dto.responsibleUserId,
        notes: dto.notes,
      },
    });
    await this.auditLogs.log({ action: 'LAUNCH_READINESS_ITEM_ADDED', entityType: 'LaunchReadinessItem', entityId: item.id, userId, severity: AuditSeverity.LOW });
    return item;
  }
}
