import { Injectable, NotFoundException } from '@nestjs/common';
import { DataQualityIssueStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateDataQualityIssueDto } from './dto/create-data-quality-issue.dto';
import { DataQualityCheckRunnerService } from './data-quality-check-runner.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class DataQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly checkRunner: DataQualityCheckRunnerService,
  ) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, entityType, issueType, severity, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);
    if (entityType) where.entityType = entityType;
    if (issueType) where.issueType = issueType;
    if (severity) where.severity = severity;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.dataQualityIssue.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.dataQualityIssue.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.dataQualityIssue.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Data Quality Issue not found');
    return record;
  }

  async create(dto: CreateDataQualityIssueDto, user: any) {
    const record = await this.prisma.dataQualityIssue.create({
      data: { ...dto, issueNumber: `DQ-${Date.now()}` },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'DataQualityIssue', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: Partial<CreateDataQualityIssueDto>, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.dataQualityIssue.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'DataQualityIssue', entityId: id, newValue: dto as any });
    return record;
  }

  async getSummary(user: any) {
    const where = user.companyId ? { companyId: user.companyId } : {};
    const [bySeverity, byType, byStatus] = await Promise.all([
      this.prisma.dataQualityIssue.groupBy({ by: ['severity'], where, _count: true }),
      this.prisma.dataQualityIssue.groupBy({ by: ['issueType'], where, _count: true }),
      this.prisma.dataQualityIssue.groupBy({ by: ['status'], where, _count: true }),
    ]);
    const totalOpen = byStatus
      .filter((row) => ['OPEN', 'ACKNOWLEDGED'].includes(String(row.status)))
      .reduce((sum, row) => sum + row._count, 0);
    return { totalOpen, bySeverity, byType, byStatus };
  }

  async resolve(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.dataQualityIssue.update({
      where: { id },
      data: { resolvedById: user.id, resolvedAt: new Date(), status: DataQualityIssueStatus.RESOLVED },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'DataQualityIssue', entityId: id, newValue: { status: 'RESOLVED' } as any });
    return record;
  }

  async acknowledge(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.dataQualityIssue.update({ where: { id }, data: { status: DataQualityIssueStatus.ACKNOWLEDGED } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'DataQualityIssue', entityId: id, newValue: { status: 'ACKNOWLEDGED' } as any });
    return record;
  }

  async dismiss(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.dataQualityIssue.update({ where: { id }, data: { status: DataQualityIssueStatus.DISMISSED } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'DataQualityIssue', entityId: id, newValue: { status: 'DISMISSED' } as any });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.dataQualityIssue.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'DataQualityIssue', entityId: id, newValue: {} as any });
    return { message: 'Deleted' };
  }

  async runChecks(user: any) {
    const ts = Date.now();
    const result = await this.checkRunner.runAll(user);
    await this.audit.log({
      userId: user.id,
      action: 'DATA_QUALITY_CHECK_RUN',
      entityType: 'DataQualityCheck',
      entityId: `check-${ts}`,
      companyId: user.companyId ?? undefined,
      newValue: result as any,
    });
    return result;
  }
}
