import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditSeverity,
  BackgroundJobStatus,
  BackupJobStatus,
  BackupRunStatus,
  HealthCheckStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

interface CheckResult {
  status: HealthCheckStatus;
  message: string;
}

@Injectable()
export class SystemHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, limit = 20, checkType, status, isActive } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (checkType) where.checkType = checkType;
    if (status) where.status = status;
    if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;

    const [data, total] = await Promise.all([
      this.prisma.systemHealthCheck.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.systemHealthCheck.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.systemHealthCheck.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Health check not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.systemHealthCheck.create({
      data: {
        healthCheckCode: 'HC-' + Date.now(),
        name: dto.name,
        checkType: dto.checkType,
        endpointOrTarget: dto.endpointOrTarget,
        status: 'UNKNOWN',
        isActive: dto.isActive ?? true,
      },
    });
    await this.auditLogs.log({
      action: 'HEALTH_CHECK_CREATED',
      entityType: 'SystemHealthCheck',
      entityId: record.id,
      userId,
      severity: AuditSeverity.LOW,
    });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.systemHealthCheck.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.checkType !== undefined && { checkType: dto.checkType }),
        ...(dto.endpointOrTarget !== undefined && { endpointOrTarget: dto.endpointOrTarget }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    await this.auditLogs.log({
      action: 'HEALTH_CHECK_UPDATED',
      entityType: 'SystemHealthCheck',
      entityId: id,
      userId,
      oldValue: existing as any,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });
    return record;
  }

  async runCheck(id: string, userId: string) {
    const check = await this.findOne(id);
    const start = Date.now();
    let status: HealthCheckStatus = HealthCheckStatus.UNKNOWN;
    let message = '';

    try {
      const result = await this.runAutomatedCheck(check.checkType, check.endpointOrTarget);
      status = result.status;
      message = result.message;
    } catch (err) {
      status = HealthCheckStatus.CRITICAL;
      message = err instanceof Error ? err.message : 'Check failed';
    }

    const durationMs = Date.now() - start;
    const now = new Date();
    const record = await this.prisma.systemHealthCheck.update({
      where: { id },
      data: {
        status,
        lastCheckedAt: now,
        lastMessage: message,
        responseTimeMs: durationMs,
        ...(status === HealthCheckStatus.HEALTHY ? { lastSuccessAt: now } : { lastFailureAt: now }),
      },
    });

    await this.auditLogs.log({
      action: 'HEALTH_CHECK_RUN',
      entityType: 'SystemHealthCheck',
      entityId: id,
      userId,
      metadata: { status, durationMs },
      severity: AuditSeverity.LOW,
    });
    return record;
  }

  async runAll(userId: string) {
    const checks = await this.prisma.systemHealthCheck.findMany({
      where: { deletedAt: null, isActive: true },
    });
    const results = await Promise.all(checks.map((c) => this.runCheck(c.id, userId)));
    return { ran: results.length, results };
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.systemHealthCheck.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'HEALTH_CHECK_DELETED',
      entityType: 'SystemHealthCheck',
      entityId: id,
      userId,
      severity: AuditSeverity.LOW,
    });
    return { success: true };
  }

  private async runAutomatedCheck(
    checkType: string,
    endpointOrTarget?: string | null,
  ): Promise<CheckResult> {
    switch (checkType) {
      case 'DATABASE':
        await this.prisma.$queryRaw`SELECT 1`;
        return { status: HealthCheckStatus.HEALTHY, message: 'Database connection OK' };
      case 'QUEUE':
        return this.checkQueueHealth();
      case 'BACKUP':
        return this.checkBackupHealth();
      case 'STORAGE':
        return this.checkStorageHealth(endpointOrTarget);
      case 'CACHE':
        return this.checkCacheConfiguration();
      default:
        return {
          status: HealthCheckStatus.UNKNOWN,
          message: `Check type ${checkType} is not automated`,
        };
    }
  }

  private async checkQueueHealth(): Promise<CheckResult> {
    const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const [deadLetterJobs, staleRunningJobs] = await Promise.all([
      this.prisma.backgroundJob.count({ where: { status: BackgroundJobStatus.DEAD_LETTER } }),
      this.prisma.backgroundJob.count({
        where: { status: BackgroundJobStatus.RUNNING, startedAt: { lt: staleCutoff } },
      }),
    ]);

    if (deadLetterJobs > 0) {
      return {
        status: HealthCheckStatus.CRITICAL,
        message: `${deadLetterJobs} background jobs are in the dead-letter queue`,
      };
    }
    if (staleRunningJobs > 0) {
      return {
        status: HealthCheckStatus.WARNING,
        message: `${staleRunningJobs} background jobs have been running for more than 2 hours`,
      };
    }
    return { status: HealthCheckStatus.HEALTHY, message: 'Background job queues are clear' };
  }

  private async checkBackupHealth(): Promise<CheckResult> {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [activeJobs, overdueJobs, failedRuns] = await Promise.all([
      this.prisma.backupJob.count({
        where: { deletedAt: null, status: BackupJobStatus.ACTIVE },
      }),
      this.prisma.backupJob.count({
        where: { deletedAt: null, status: BackupJobStatus.ACTIVE, nextRunAt: { lt: new Date() } },
      }),
      this.prisma.backupRun.count({
        where: { status: BackupRunStatus.FAILED, createdAt: { gte: last24h } },
      }),
    ]);

    if (activeJobs === 0) {
      return {
        status: HealthCheckStatus.CRITICAL,
        message: 'No active backup jobs are configured',
      };
    }
    if (overdueJobs > 0) {
      return {
        status: HealthCheckStatus.CRITICAL,
        message: `${overdueJobs} backup jobs are overdue`,
      };
    }
    if (failedRuns > 0) {
      return {
        status: HealthCheckStatus.WARNING,
        message: `${failedRuns} backup runs failed in the last 24 hours`,
      };
    }
    return { status: HealthCheckStatus.HEALTHY, message: 'Backup schedule is healthy' };
  }

  private async checkStorageHealth(endpointOrTarget?: string | null): Promise<CheckResult> {
    const target =
      endpointOrTarget ??
      process.env.STORAGE_LOCAL_PATH ??
      process.env.LOCAL_STORAGE_PATH ??
      process.env.BACKUP_STORAGE_PATH ??
      process.env.EXPORT_STORAGE_PATH ??
      process.cwd();
    await access(target, fsConstants.R_OK | fsConstants.W_OK);
    return { status: HealthCheckStatus.HEALTHY, message: `Storage path is readable and writable` };
  }

  private checkCacheConfiguration(): CheckResult {
    const configured = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
    if (!configured) {
      return {
        status: HealthCheckStatus.WARNING,
        message: 'Redis cache is not configured; falling back to in-memory cache',
      };
    }
    return { status: HealthCheckStatus.HEALTHY, message: 'Redis cache configuration is present' };
  }
}
