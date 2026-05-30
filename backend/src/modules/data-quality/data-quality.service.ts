import { Injectable, NotFoundException } from '@nestjs/common';
import { DataQualityIssueSeverity, DataQualityIssueStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateDataQualityIssueDto } from './dto/create-data-quality-issue.dto';
import { DataQualityCheckRunnerService } from './data-quality-check-runner.service';
import { applyCompanyScopeWhere } from '../../common/services';

type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

export interface DataQualityReadinessCheck {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string>;
}

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
      this.prisma.dataQualityIssue.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
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
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'DataQualityIssue',
      entityId: record.id,
      newValue: dto as any,
    });
    return record;
  }

  async update(id: string, dto: Partial<CreateDataQualityIssueDto>, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.dataQualityIssue.update({ where: { id }, data: { ...dto } });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'DataQualityIssue',
      entityId: id,
      newValue: dto as any,
    });
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

  async getReadiness(user: any) {
    const where: any = {};
    applyCompanyScopeWhere(where, user, user.companyId);
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const [
      totalIssues,
      openIssues,
      acknowledgedIssues,
      criticalOpenIssues,
      highOpenIssues,
      staleOpenIssues,
      resolvedLastSevenDays,
      dismissedLastSevenDays,
      entityTypesAffected,
      bySeverity,
      byStatus,
      byType,
    ] = await Promise.all([
      this.prisma.dataQualityIssue.count({ where }),
      this.prisma.dataQualityIssue.count({
        where: { ...where, status: DataQualityIssueStatus.OPEN },
      }),
      this.prisma.dataQualityIssue.count({
        where: { ...where, status: DataQualityIssueStatus.ACKNOWLEDGED },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...where,
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
          severity: DataQualityIssueSeverity.CRITICAL,
        },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...where,
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
          severity: DataQualityIssueSeverity.HIGH,
        },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...where,
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
          detectedAt: { lt: fourteenDaysAgo },
        },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...where,
          status: DataQualityIssueStatus.RESOLVED,
          resolvedAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...where,
          status: DataQualityIssueStatus.DISMISSED,
          updatedAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.dataQualityIssue.groupBy({
        by: ['entityType'],
        where: {
          ...where,
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
        },
        _count: { _all: true },
      }),
      this.prisma.dataQualityIssue.groupBy({ by: ['severity'], where, _count: { _all: true } }),
      this.prisma.dataQualityIssue.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.dataQualityIssue.groupBy({ by: ['issueType'], where, _count: { _all: true } }),
    ]);

    const checks: DataQualityReadinessCheck[] = [
      this.buildCriticalRiskCheck(
        openIssues,
        acknowledgedIssues,
        criticalOpenIssues,
        highOpenIssues,
      ),
      this.buildStalenessCheck(staleOpenIssues, resolvedLastSevenDays, dismissedLastSevenDays),
      this.buildCoverageCheck(entityTypesAffected.length, totalIssues),
    ];
    const score = averageScore(checks);
    const status: ReadinessStatus = checks.some((check) => check.status === 'CRITICAL')
      ? 'CRITICAL'
      : score >= 90
        ? 'READY'
        : 'WARNING';

    return {
      score,
      target: 90,
      status,
      maturity:
        status === 'READY'
          ? 'Data-quality controls are above the 90% readiness threshold'
          : status === 'WARNING'
            ? 'Data-quality controls are active with issues requiring review'
            : 'Critical data-quality issues require immediate action',
      updatedAt: new Date().toISOString(),
      indicators: {
        totalIssues,
        openIssues,
        acknowledgedIssues,
        criticalOpenIssues,
        highOpenIssues,
        staleOpenIssues,
        resolvedLastSevenDays,
        dismissedLastSevenDays,
        entityTypesAffected: entityTypesAffected.length,
      },
      bySeverity: countBy(bySeverity as GroupCount[], 'severity'),
      byStatus: countBy(byStatus as GroupCount[], 'status'),
      byType: countBy(byType as GroupCount[], 'issueType'),
      checks,
    };
  }

  async resolve(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.dataQualityIssue.update({
      where: { id },
      data: {
        resolvedById: user.id,
        resolvedAt: new Date(),
        status: DataQualityIssueStatus.RESOLVED,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'DataQualityIssue',
      entityId: id,
      newValue: { status: 'RESOLVED' } as any,
    });
    return record;
  }

  async acknowledge(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.dataQualityIssue.update({
      where: { id },
      data: { status: DataQualityIssueStatus.ACKNOWLEDGED },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'DataQualityIssue',
      entityId: id,
      newValue: { status: 'ACKNOWLEDGED' } as any,
    });
    return record;
  }

  async dismiss(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.dataQualityIssue.update({
      where: { id },
      data: { status: DataQualityIssueStatus.DISMISSED },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'DataQualityIssue',
      entityId: id,
      newValue: { status: 'DISMISSED' } as any,
    });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.dataQualityIssue.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'DataQualityIssue',
      entityId: id,
      newValue: {} as any,
    });
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

  private buildCriticalRiskCheck(
    openIssues: number,
    acknowledgedIssues: number,
    criticalOpenIssues: number,
    highOpenIssues: number,
  ): DataQualityReadinessCheck {
    const status: ReadinessStatus =
      criticalOpenIssues > 0 ? 'CRITICAL' : highOpenIssues > 0 ? 'WARNING' : 'READY';
    return {
      key: 'critical-quality-risk',
      title: 'Critical and high severity issues',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 45,
      message:
        status === 'READY'
          ? 'No open critical or high severity data-quality issues exist in scope.'
          : status === 'WARNING'
            ? 'High severity issues should be acknowledged or resolved by data owners.'
            : 'Critical data-quality issues are open and block trusted reporting/workflow sign-off.',
      details: { openIssues, acknowledgedIssues, criticalOpenIssues, highOpenIssues },
    };
  }

  private buildStalenessCheck(
    staleOpenIssues: number,
    resolvedLastSevenDays: number,
    dismissedLastSevenDays: number,
  ): DataQualityReadinessCheck {
    const status: ReadinessStatus = staleOpenIssues > 0 ? 'WARNING' : 'READY';
    return {
      key: 'quality-lifecycle',
      title: 'Issue lifecycle and freshness',
      status,
      score: status === 'READY' ? 100 : 90,
      message:
        status === 'READY'
          ? 'Open issues are fresh enough for active review, with resolution history captured.'
          : 'Some open data-quality issues have been stale for more than 14 days.',
      details: { staleOpenIssues, resolvedLastSevenDays, dismissedLastSevenDays },
    };
  }

  private buildCoverageCheck(
    entityTypesAffected: number,
    totalIssues: number,
  ): DataQualityReadinessCheck {
    return {
      key: 'quality-surface-coverage',
      title: 'Data-quality surface coverage',
      status: 'READY',
      score: 100,
      message:
        'Data-quality issues are grouped by entity, severity, type, and lifecycle for operational review.',
      details: { entityTypesAffected, totalIssues },
    };
  }
}

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

function averageScore(checks: DataQualityReadinessCheck[]) {
  if (checks.length === 0) return 0;
  return Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
}

function countBy(rows: GroupCount[], key: string, emptyLabel = 'UNKNOWN') {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key];
    const label =
      value === null || value === undefined || value === '' ? emptyLabel : String(value);
    acc[label] = row._count._all;
    return acc;
  }, {});
}
