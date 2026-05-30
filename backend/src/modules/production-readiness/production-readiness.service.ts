import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditSeverity,
  BackupJobStatus,
  BackupRunStatus,
  DisasterRecoveryPlanStatus,
  EnvironmentConfigStatus,
  ErrorLogSeverity,
  ErrorLogStatus,
  HealthCheckStatus,
  ProductionReadinessPriority,
  ProductionReadinessStatus,
  RestoreTestStatus,
  RetentionPolicyStatus,
  SecurityEventSeverity,
  SecurityEventStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';
type DetailValue = number | string;

export interface ProductionReadinessCheckResult {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, DetailValue>;
}

@Injectable()
export class ProductionReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, limit = 20, category, status, priority } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (category) where.category = category;
    if (status) where.status = status;
    if (priority) where.priority = priority;

    const [data, total] = await Promise.all([
      this.prisma.productionReadinessCheck.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.productionReadinessCheck.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.productionReadinessCheck.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Production readiness check not found');
    return record;
  }

  async getSummary() {
    const [readiness, records] = await Promise.all([
      this.getReadiness(),
      this.prisma.productionReadinessCheck.findMany({
        where: { deletedAt: null },
        take: 100,
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        include: {
          responsibleUser: { select: { id: true, fullName: true, email: true } },
          completedBy: { select: { id: true, fullName: true, email: true } },
        },
      }),
    ]);

    return {
      readiness,
      records,
      totals: readiness.indicators,
      generatedAt: new Date().toISOString(),
    };
  }

  async getReadiness() {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const openReadinessStatuses = [
      ProductionReadinessStatus.NOT_STARTED,
      ProductionReadinessStatus.IN_PROGRESS,
      ProductionReadinessStatus.FAILED,
    ];

    const [
      totalChecks,
      passedChecks,
      failedChecks,
      criticalOpenChecks,
      overdueOpenChecks,
      requiredConfigChecks,
      failedRequiredConfigChecks,
      warningConfigChecks,
      activeSecurityPolicies,
      activeUsers,
      usersWithoutRoles,
      systemRoles,
      permissions,
      unresolvedCriticalSecurityEvents,
      activeBackupJobs,
      failedBackupRuns,
      recentCompletedBackupRuns,
      recentPassedRestoreTests,
      activeDrPlans,
      activeHealthChecks,
      failingHealthChecks,
      openCriticalErrors,
      openHighErrors,
      activeRetentionPolicies,
      readinessByStatus,
      readinessByCategory,
    ] = await Promise.all([
      this.prisma.productionReadinessCheck.count({ where: { deletedAt: null } }),
      this.prisma.productionReadinessCheck.count({
        where: { deletedAt: null, status: ProductionReadinessStatus.PASSED },
      }),
      this.prisma.productionReadinessCheck.count({
        where: { deletedAt: null, status: ProductionReadinessStatus.FAILED },
      }),
      this.prisma.productionReadinessCheck.count({
        where: {
          deletedAt: null,
          priority: ProductionReadinessPriority.CRITICAL,
          status: { in: openReadinessStatuses },
        },
      }),
      this.prisma.productionReadinessCheck.count({
        where: {
          deletedAt: null,
          dueDate: { lt: now },
          status: { in: openReadinessStatuses },
        },
      }),
      this.prisma.environmentConfigCheck.count({ where: { required: true } }),
      this.prisma.environmentConfigCheck.count({
        where: {
          required: true,
          OR: [{ status: EnvironmentConfigStatus.FAIL }, { present: false }, { valid: false }],
        },
      }),
      this.prisma.environmentConfigCheck.count({
        where: {
          required: true,
          status: { in: [EnvironmentConfigStatus.WARNING, EnvironmentConfigStatus.UNKNOWN] },
        },
      }),
      this.prisma.securityPolicy.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.user.count({
        where: { deletedAt: null, status: 'ACTIVE', userRoles: { none: {} } },
      }),
      this.prisma.role.count({ where: { isSystem: true } }),
      this.prisma.permission.count(),
      this.prisma.securityEvent.count({
        where: {
          status: SecurityEventStatus.OPEN,
          severity: { in: [SecurityEventSeverity.HIGH, SecurityEventSeverity.CRITICAL] },
        },
      }),
      this.prisma.backupJob.count({
        where: { deletedAt: null, status: BackupJobStatus.ACTIVE },
      }),
      this.prisma.backupRun.count({
        where: {
          status: BackupRunStatus.FAILED,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.backupRun.count({
        where: {
          status: BackupRunStatus.COMPLETED,
          completedAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.restoreTest.count({
        where: {
          deletedAt: null,
          status: RestoreTestStatus.PASSED,
          completedAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.disasterRecoveryPlan.count({
        where: { deletedAt: null, status: DisasterRecoveryPlanStatus.ACTIVE },
      }),
      this.prisma.systemHealthCheck.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.systemHealthCheck.count({
        where: {
          deletedAt: null,
          isActive: true,
          status: { in: [HealthCheckStatus.CRITICAL, HealthCheckStatus.UNKNOWN] },
        },
      }),
      this.prisma.errorLog.count({
        where: {
          status: ErrorLogStatus.OPEN,
          severity: ErrorLogSeverity.CRITICAL,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.errorLog.count({
        where: {
          status: ErrorLogStatus.OPEN,
          severity: ErrorLogSeverity.HIGH,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.retentionPolicy.count({
        where: { status: RetentionPolicyStatus.ACTIVE },
      }),
      this.prisma.productionReadinessCheck.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.productionReadinessCheck.groupBy({
        by: ['category'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const checks: ProductionReadinessCheckResult[] = [
      this.buildChecklistCheck(
        totalChecks,
        passedChecks,
        failedChecks,
        criticalOpenChecks,
        overdueOpenChecks,
      ),
      this.buildEnvironmentCheck(
        requiredConfigChecks,
        failedRequiredConfigChecks,
        warningConfigChecks,
      ),
      this.buildAdminSecurityCheck(
        activeSecurityPolicies,
        activeUsers,
        usersWithoutRoles,
        systemRoles,
        permissions,
        unresolvedCriticalSecurityEvents,
      ),
      this.buildBackupDrCheck(
        activeBackupJobs,
        failedBackupRuns,
        recentCompletedBackupRuns,
        recentPassedRestoreTests,
        activeDrPlans,
      ),
      this.buildMonitoringCheck(
        activeHealthChecks,
        failingHealthChecks,
        openCriticalErrors,
        openHighErrors,
      ),
      this.buildGovernanceCheck(activeRetentionPolicies, systemRoles, permissions),
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
          ? 'Production/admin/governance controls are above the 90% readiness threshold'
          : status === 'WARNING'
            ? 'Production controls are usable but need governance review'
            : 'Production readiness blockers require immediate action',
      updatedAt: new Date().toISOString(),
      indicators: {
        totalChecks,
        passedChecks,
        failedChecks,
        criticalOpenChecks,
        overdueOpenChecks,
        requiredConfigChecks,
        failedRequiredConfigChecks,
        warningConfigChecks,
        activeSecurityPolicies,
        activeUsers,
        usersWithoutRoles,
        systemRoles,
        permissions,
        unresolvedCriticalSecurityEvents,
        activeBackupJobs,
        failedBackupRuns,
        recentCompletedBackupRuns,
        recentPassedRestoreTests,
        activeDrPlans,
        activeHealthChecks,
        failingHealthChecks,
        openCriticalErrors,
        openHighErrors,
        activeRetentionPolicies,
      },
      readinessByStatus: countBy(readinessByStatus as GroupCount[], 'status'),
      readinessByCategory: countBy(readinessByCategory as GroupCount[], 'category'),
      checks,
    };
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.productionReadinessCheck.create({
      data: {
        checkCode: 'PR-' + Date.now(),
        category: dto.category,
        title: dto.title,
        description: dto.description,
        status: dto.status ?? 'NOT_STARTED',
        priority: dto.priority ?? 'MEDIUM',
        responsibleUserId: dto.responsibleUserId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        evidenceDocumentId: dto.evidenceDocumentId,
        notes: dto.notes,
      },
    });
    await this.auditLogs.log({
      action: 'PROD_READINESS_CREATED',
      entityType: 'ProductionReadinessCheck',
      entityId: record.id,
      userId,
      severity: AuditSeverity.MEDIUM,
    });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.productionReadinessCheck.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.responsibleUserId !== undefined && { responsibleUserId: dto.responsibleUserId }),
        ...(dto.dueDate !== undefined && { dueDate: new Date(dto.dueDate) }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.evidenceDocumentId !== undefined && { evidenceDocumentId: dto.evidenceDocumentId }),
      },
    });
    await this.auditLogs.log({
      action: 'PROD_READINESS_UPDATED',
      entityType: 'ProductionReadinessCheck',
      entityId: id,
      userId,
      oldValue: existing as any,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });
    return record;
  }

  async markComplete(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.productionReadinessCheck.update({
      where: { id },
      data: {
        status: 'PASSED',
        completedById: userId,
        completedAt: new Date(),
        notes: dto.notes ?? existing.notes,
      },
    });
    await this.auditLogs.log({
      action: 'PROD_READINESS_COMPLETED',
      entityType: 'ProductionReadinessCheck',
      entityId: id,
      userId,
      severity: AuditSeverity.MEDIUM,
    });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.productionReadinessCheck.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'PROD_READINESS_DELETED',
      entityType: 'ProductionReadinessCheck',
      entityId: id,
      userId,
      severity: AuditSeverity.MEDIUM,
    });
    return { success: true };
  }

  private buildChecklistCheck(
    totalChecks: number,
    passedChecks: number,
    failedChecks: number,
    criticalOpenChecks: number,
    overdueOpenChecks: number,
  ): ProductionReadinessCheckResult {
    const status: ReadinessStatus =
      failedChecks > 0 || criticalOpenChecks > 0
        ? 'CRITICAL'
        : overdueOpenChecks > 0
          ? 'WARNING'
          : 'READY';
    return {
      key: 'production-checklist',
      title: 'Production readiness checklist',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 45,
      message:
        status === 'READY'
          ? 'No failed, overdue, or critical open readiness checks are blocking deployment.'
          : status === 'WARNING'
            ? 'Some readiness checks are overdue and should be closed before major releases.'
            : 'Failed or critical production readiness checks are open.',
      details: { totalChecks, passedChecks, failedChecks, criticalOpenChecks, overdueOpenChecks },
    };
  }

  private buildEnvironmentCheck(
    requiredConfigChecks: number,
    failedRequiredConfigChecks: number,
    warningConfigChecks: number,
  ): ProductionReadinessCheckResult {
    const status: ReadinessStatus =
      failedRequiredConfigChecks > 0 ? 'CRITICAL' : warningConfigChecks > 0 ? 'WARNING' : 'READY';
    return {
      key: 'environment-config',
      title: 'Environment and deployment configuration',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 92 : 50,
      message:
        status === 'READY'
          ? 'Required environment configuration checks are valid.'
          : status === 'WARNING'
            ? 'Required configuration exists with warnings or unknown validation state.'
            : 'Required environment configuration is missing or invalid.',
      details: { requiredConfigChecks, failedRequiredConfigChecks, warningConfigChecks },
    };
  }

  private buildAdminSecurityCheck(
    activeSecurityPolicies: number,
    activeUsers: number,
    usersWithoutRoles: number,
    systemRoles: number,
    permissions: number,
    unresolvedCriticalSecurityEvents: number,
  ): ProductionReadinessCheckResult {
    const status: ReadinessStatus =
      unresolvedCriticalSecurityEvents > 0 || usersWithoutRoles > 0
        ? 'CRITICAL'
        : activeSecurityPolicies === 0
          ? 'WARNING'
          : 'READY';
    return {
      key: 'admin-security-governance',
      title: 'Admin, security, and access governance',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 55,
      message:
        status === 'READY'
          ? 'Security policies, role assignments, and permission catalog coverage are in place.'
          : status === 'WARNING'
            ? 'No active security policy has been configured yet.'
            : 'Unresolved high-risk security events or active users without roles need action.',
      details: {
        activeSecurityPolicies,
        activeUsers,
        usersWithoutRoles,
        systemRoles,
        permissions,
        unresolvedCriticalSecurityEvents,
      },
    };
  }

  private buildBackupDrCheck(
    activeBackupJobs: number,
    failedBackupRuns: number,
    recentCompletedBackupRuns: number,
    recentPassedRestoreTests: number,
    activeDrPlans: number,
  ): ProductionReadinessCheckResult {
    const status: ReadinessStatus =
      failedBackupRuns > 0
        ? 'CRITICAL'
        : activeBackupJobs === 0 || activeDrPlans === 0
          ? 'WARNING'
          : 'READY';
    return {
      key: 'backup-dr',
      title: 'Backup, restore, and disaster recovery',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 88 : 45,
      message:
        status === 'READY'
          ? 'Backup jobs, recent backup evidence, restore tests, and DR plans are visible.'
          : status === 'WARNING'
            ? 'Backup or DR plans need configuration evidence before formal production sign-off.'
            : 'Recent backup failures must be resolved before production sign-off.',
      details: {
        activeBackupJobs,
        failedBackupRuns,
        recentCompletedBackupRuns,
        recentPassedRestoreTests,
        activeDrPlans,
      },
    };
  }

  private buildMonitoringCheck(
    activeHealthChecks: number,
    failingHealthChecks: number,
    openCriticalErrors: number,
    openHighErrors: number,
  ): ProductionReadinessCheckResult {
    const status: ReadinessStatus =
      failingHealthChecks > 0 || openCriticalErrors > 0
        ? 'CRITICAL'
        : openHighErrors > 0 || activeHealthChecks === 0
          ? 'WARNING'
          : 'READY';
    return {
      key: 'monitoring-ops',
      title: 'Monitoring and operational health',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 50,
      message:
        status === 'READY'
          ? 'Health checks and recent error telemetry show no critical production blockers.'
          : status === 'WARNING'
            ? 'Monitoring exists with warnings, high errors, or missing active health checks.'
            : 'Critical health checks or runtime errors require immediate action.',
      details: { activeHealthChecks, failingHealthChecks, openCriticalErrors, openHighErrors },
    };
  }

  private buildGovernanceCheck(
    activeRetentionPolicies: number,
    systemRoles: number,
    permissions: number,
  ): ProductionReadinessCheckResult {
    const status: ReadinessStatus =
      systemRoles === 0 || permissions === 0
        ? 'CRITICAL'
        : activeRetentionPolicies === 0
          ? 'WARNING'
          : 'READY';
    return {
      key: 'governance-retention',
      title: 'Governance, retention, and audit controls',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 45,
      message:
        status === 'READY'
          ? 'Retention policy and RBAC governance foundations are configured.'
          : status === 'WARNING'
            ? 'RBAC foundations exist, but no active retention policy is configured.'
            : 'RBAC governance foundations are missing.',
      details: { activeRetentionPolicies, systemRoles, permissions },
    };
  }
}

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

function averageScore(checks: ProductionReadinessCheckResult[]) {
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
