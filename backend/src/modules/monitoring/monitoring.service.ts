import { Injectable } from '@nestjs/common';
import {
  AuditSeverity,
  BackgroundJobStatus,
  BackupJobStatus,
  BackupRunStatus,
  DataArchiveJobStatus,
  ErrorLogSeverity,
  ErrorLogStatus,
  HealthCheckStatus,
  RetentionPolicyStatus,
  SecurityEventSeverity,
  SecurityEventStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type OperationalStatus = 'ok' | 'degraded' | 'critical';
export type ReadinessBlockerSeverity = 'critical' | 'warning';

export interface ReadinessBlocker {
  severity: ReadinessBlockerSeverity;
  category: string;
  message: string;
  metric: string;
  value: number;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function countByStatus<T extends string>(
  rows: Array<{ status: T; _count: { id: number } }>,
  status: T,
): number {
  return rows.find((row) => row.status === status)?._count.id ?? 0;
}

function readinessScore(blockers: ReadinessBlocker[]): number {
  const penalty = blockers.reduce((total, blocker) => {
    return total + (blocker.severity === 'critical' ? 12 : 4);
  }, 0);
  return Math.max(0, 100 - penalty);
}

@Injectable()
export class MonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const [healthChecks, recentErrors, recentMetrics, backupSummary, operationalReadiness] =
      await Promise.all([
        this.prisma.systemHealthCheck.findMany({
          where: { deletedAt: null, isActive: true },
          orderBy: { lastCheckedAt: 'desc' },
        }),
        this.prisma.errorLog.findMany({
          where: { status: { in: [ErrorLogStatus.OPEN, ErrorLogStatus.ACKNOWLEDGED] } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            errorNumber: true,
            module: true,
            errorType: true,
            message: true,
            severity: true,
            status: true,
            createdAt: true,
          },
        }),
        this.prisma.systemMetric.findMany({
          orderBy: { recordedAt: 'desc' },
          take: 20,
        }),
        this.prisma.backupJob.findMany({
          where: { deletedAt: null, status: BackupJobStatus.ACTIVE },
          select: {
            id: true,
            name: true,
            backupType: true,
            lastRunAt: true,
            nextRunAt: true,
            status: true,
          },
          take: 10,
        }),
        this.getOperationalReadiness(),
      ]);

    return {
      healthChecks,
      recentErrors,
      recentMetrics,
      backupSummary,
      operationalReadiness,
    };
  }

  async getOperationalReadiness() {
    const now = new Date();
    const last24h = new Date(now.getTime() - DAY_MS);
    const staleHealthCutoff = new Date(now.getTime() - 15 * MINUTE_MS);
    const staleRunningJobCutoff = new Date(now.getTime() - 2 * HOUR_MS);
    const oldQueuedJobCutoff = new Date(now.getTime() - HOUR_MS);

    const [
      healthByStatus,
      staleHealthChecks,
      openCriticalErrors,
      openHighErrors,
      openErrors,
      openCriticalSecurityEvents,
      openHighSecurityEvents,
      openSecurityEvents,
      criticalSecurityEventsLast24h,
      auditEventsLast24h,
      highRiskAuditEventsLast24h,
      latestAuditEvent,
      activeBackupJobs,
      overdueBackupJobs,
      failedBackupRunsLast24h,
      latestCompletedBackupRun,
      deadLetterJobs,
      failedJobs,
      staleRunningJobs,
      oldQueuedJobs,
      activeRetentionPolicies,
      draftRetentionPolicies,
      legalHoldPolicies,
      activeArchiveJobs,
      failedArchiveJobs,
    ] = await Promise.all([
      this.prisma.systemHealthCheck.groupBy({
        by: ['status'],
        where: { deletedAt: null, isActive: true },
        _count: { id: true },
      }),
      this.prisma.systemHealthCheck.count({
        where: {
          deletedAt: null,
          isActive: true,
          OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: staleHealthCutoff } }],
        },
      }),
      this.prisma.errorLog.count({
        where: { status: ErrorLogStatus.OPEN, severity: ErrorLogSeverity.CRITICAL },
      }),
      this.prisma.errorLog.count({
        where: { status: ErrorLogStatus.OPEN, severity: ErrorLogSeverity.HIGH },
      }),
      this.prisma.errorLog.count({
        where: { status: { in: [ErrorLogStatus.OPEN, ErrorLogStatus.ACKNOWLEDGED] } },
      }),
      this.prisma.securityEvent.count({
        where: { status: SecurityEventStatus.OPEN, severity: SecurityEventSeverity.CRITICAL },
      }),
      this.prisma.securityEvent.count({
        where: { status: SecurityEventStatus.OPEN, severity: SecurityEventSeverity.HIGH },
      }),
      this.prisma.securityEvent.count({
        where: { status: { in: [SecurityEventStatus.OPEN, SecurityEventStatus.REVIEWED] } },
      }),
      this.prisma.securityEvent.count({
        where: {
          severity: SecurityEventSeverity.CRITICAL,
          createdAt: { gte: last24h },
        },
      }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: last24h } } }),
      this.prisma.auditLog.count({
        where: {
          severity: { in: [AuditSeverity.CRITICAL, AuditSeverity.HIGH] },
          createdAt: { gte: last24h },
        },
      }),
      this.prisma.auditLog.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { id: true, action: true, severity: true, createdAt: true },
      }),
      this.prisma.backupJob.count({
        where: { deletedAt: null, status: BackupJobStatus.ACTIVE },
      }),
      this.prisma.backupJob.count({
        where: {
          deletedAt: null,
          status: BackupJobStatus.ACTIVE,
          nextRunAt: { lt: now },
        },
      }),
      this.prisma.backupRun.count({
        where: { status: BackupRunStatus.FAILED, createdAt: { gte: last24h } },
      }),
      this.prisma.backupRun.findFirst({
        where: { status: BackupRunStatus.COMPLETED },
        orderBy: { completedAt: 'desc' },
        select: { id: true, backupRunNumber: true, completedAt: true, backupType: true },
      }),
      this.prisma.backgroundJob.count({
        where: { status: BackgroundJobStatus.DEAD_LETTER },
      }),
      this.prisma.backgroundJob.count({
        where: { status: BackgroundJobStatus.FAILED },
      }),
      this.prisma.backgroundJob.count({
        where: {
          status: BackgroundJobStatus.RUNNING,
          startedAt: { lt: staleRunningJobCutoff },
        },
      }),
      this.prisma.backgroundJob.count({
        where: {
          status: BackgroundJobStatus.QUEUED,
          createdAt: { lt: oldQueuedJobCutoff },
        },
      }),
      this.prisma.retentionPolicy.count({
        where: { deletedAt: null, status: RetentionPolicyStatus.ACTIVE },
      }),
      this.prisma.retentionPolicy.count({
        where: { deletedAt: null, status: RetentionPolicyStatus.DRAFT },
      }),
      this.prisma.retentionPolicy.count({
        where: { deletedAt: null, legalHold: true },
      }),
      this.prisma.dataArchiveJob.count({
        where: {
          deletedAt: null,
          status: {
            in: [
              DataArchiveJobStatus.REQUESTED,
              DataArchiveJobStatus.APPROVED,
              DataArchiveJobStatus.RUNNING,
            ],
          },
        },
      }),
      this.prisma.dataArchiveJob.count({
        where: { deletedAt: null, status: DataArchiveJobStatus.FAILED },
      }),
    ]);

    const health = {
      healthy: countByStatus(healthByStatus, HealthCheckStatus.HEALTHY),
      warning: countByStatus(healthByStatus, HealthCheckStatus.WARNING),
      critical: countByStatus(healthByStatus, HealthCheckStatus.CRITICAL),
      unknown: countByStatus(healthByStatus, HealthCheckStatus.UNKNOWN),
      stale: staleHealthChecks,
      active: healthByStatus.reduce((sum, row) => sum + row._count.id, 0),
    };

    const blockers: ReadinessBlocker[] = [];
    const addBlocker = (
      condition: boolean,
      blocker: Omit<ReadinessBlocker, 'value'> & { value: number },
    ) => {
      if (condition) blockers.push(blocker);
    };

    addBlocker(health.critical > 0, {
      severity: 'critical',
      category: 'health',
      message: 'One or more active health checks are critical.',
      metric: 'health.critical',
      value: health.critical,
    });
    addBlocker(health.warning + health.unknown + health.stale > 0, {
      severity: 'warning',
      category: 'health',
      message: 'Some health checks need attention or have not run recently.',
      metric: 'health.warningUnknownOrStale',
      value: health.warning + health.unknown + health.stale,
    });
    addBlocker(health.active === 0, {
      severity: 'warning',
      category: 'health',
      message: 'No active system health checks are configured.',
      metric: 'health.active',
      value: health.active,
    });
    addBlocker(openCriticalErrors > 0, {
      severity: 'critical',
      category: 'errors',
      message: 'Open critical application errors exist.',
      metric: 'errors.openCritical',
      value: openCriticalErrors,
    });
    addBlocker(openHighErrors > 0, {
      severity: 'warning',
      category: 'errors',
      message: 'Open high-severity application errors exist.',
      metric: 'errors.openHigh',
      value: openHighErrors,
    });
    addBlocker(openCriticalSecurityEvents > 0, {
      severity: 'critical',
      category: 'security',
      message: 'Open critical security events require review.',
      metric: 'security.openCritical',
      value: openCriticalSecurityEvents,
    });
    addBlocker(openHighSecurityEvents > 0, {
      severity: 'warning',
      category: 'security',
      message: 'Open high-severity security events require review.',
      metric: 'security.openHigh',
      value: openHighSecurityEvents,
    });
    addBlocker(activeBackupJobs === 0, {
      severity: 'critical',
      category: 'backups',
      message: 'No active backup jobs are configured.',
      metric: 'backups.activeJobs',
      value: activeBackupJobs,
    });
    addBlocker(overdueBackupJobs > 0, {
      severity: 'critical',
      category: 'backups',
      message: 'One or more active backup jobs are overdue.',
      metric: 'backups.overdueJobs',
      value: overdueBackupJobs,
    });
    addBlocker(failedBackupRunsLast24h > 0, {
      severity: 'warning',
      category: 'backups',
      message: 'Backup failures occurred in the last 24 hours.',
      metric: 'backups.failedRunsLast24h',
      value: failedBackupRunsLast24h,
    });
    addBlocker(deadLetterJobs > 0, {
      severity: 'critical',
      category: 'jobs',
      message: 'Background jobs are in the dead-letter queue.',
      metric: 'jobs.deadLetter',
      value: deadLetterJobs,
    });
    addBlocker(failedJobs + staleRunningJobs + oldQueuedJobs > 0, {
      severity: 'warning',
      category: 'jobs',
      message: 'Background jobs have failed, stalled, or aged in queue.',
      metric: 'jobs.failedStaleOrOldQueued',
      value: failedJobs + staleRunningJobs + oldQueuedJobs,
    });
    addBlocker(activeRetentionPolicies === 0, {
      severity: 'warning',
      category: 'retention',
      message: 'No active data retention policies are configured.',
      metric: 'retention.activePolicies',
      value: activeRetentionPolicies,
    });
    addBlocker(failedArchiveJobs > 0, {
      severity: 'warning',
      category: 'retention',
      message: 'Failed data archive jobs need review.',
      metric: 'retention.failedArchiveJobs',
      value: failedArchiveJobs,
    });

    const criticalBlockers = blockers.filter((blocker) => blocker.severity === 'critical').length;
    const score = readinessScore(blockers);
    const status: OperationalStatus =
      criticalBlockers > 0 || score < 80 ? 'critical' : blockers.length > 0 ? 'degraded' : 'ok';

    return {
      status,
      readinessScore: score,
      generatedAt: now.toISOString(),
      windows: {
        healthCheckFreshnessMinutes: 15,
        staleRunningJobHours: 2,
        oldQueuedJobHours: 1,
      },
      summary: {
        health,
        errors: {
          openCritical: openCriticalErrors,
          openHigh: openHighErrors,
          unresolved: openErrors,
        },
        security: {
          openCritical: openCriticalSecurityEvents,
          openHigh: openHighSecurityEvents,
          unresolved: openSecurityEvents,
          criticalLast24h: criticalSecurityEventsLast24h,
        },
        audit: {
          eventsLast24h: auditEventsLast24h,
          highRiskEventsLast24h: highRiskAuditEventsLast24h,
          latestEvent: latestAuditEvent,
        },
        backups: {
          activeJobs: activeBackupJobs,
          overdueJobs: overdueBackupJobs,
          failedRunsLast24h: failedBackupRunsLast24h,
          latestCompletedRun: latestCompletedBackupRun,
        },
        jobs: {
          deadLetter: deadLetterJobs,
          failed: failedJobs,
          staleRunning: staleRunningJobs,
          oldQueued: oldQueuedJobs,
        },
        retention: {
          activePolicies: activeRetentionPolicies,
          draftPolicies: draftRetentionPolicies,
          legalHoldPolicies,
          activeArchiveJobs,
          failedArchiveJobs,
        },
      },
      blockers,
    };
  }

  async getPublicHealth() {
    const startedAt = Date.now();
    const checks: Array<{ name: string; status: OperationalStatus; responseTimeMs?: number }> = [];
    let database: 'up' | 'down' = 'down';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
      checks.push({ name: 'database', status: 'ok', responseTimeMs: Date.now() - startedAt });
    } catch {
      checks.push({ name: 'database', status: 'critical', responseTimeMs: Date.now() - startedAt });
    }

    let operationalStatus: OperationalStatus = database === 'up' ? 'ok' : 'critical';

    if (database === 'up') {
      const [criticalHealthChecks, openCriticalErrors, deadLetterJobs] = await Promise.all([
        this.prisma.systemHealthCheck.count({
          where: { deletedAt: null, isActive: true, status: HealthCheckStatus.CRITICAL },
        }),
        this.prisma.errorLog.count({
          where: { status: ErrorLogStatus.OPEN, severity: ErrorLogSeverity.CRITICAL },
        }),
        this.prisma.backgroundJob.count({
          where: { status: BackgroundJobStatus.DEAD_LETTER },
        }),
      ]);
      checks.push({
        name: 'operational-gates',
        status: criticalHealthChecks + openCriticalErrors + deadLetterJobs > 0 ? 'degraded' : 'ok',
      });
      operationalStatus =
        criticalHealthChecks + openCriticalErrors + deadLetterJobs > 0 ? 'degraded' : 'ok';
    }

    return {
      status: operationalStatus,
      service: 'itemba-r-api',
      version: '0.1.0',
      database,
      uptime: process.uptime(),
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
