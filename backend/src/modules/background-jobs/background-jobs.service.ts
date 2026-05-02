import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, AuditSeverity, BackgroundJobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService, ObservabilityBudgetService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class BackgroundJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly observabilityBudget: ObservabilityBudgetService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { page = 1, pageSize = 20, jobType, status, companyId, queueName } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = {
      ...((await this.companyScope.companyWhereFor(user, companyId)) as any),
    };
    if (jobType) where.jobType = jobType;
    if (status) where.status = status;
    if (queueName) where.queueName = queueName;

    const [data, total] = await Promise.all([
      this.prisma.backgroundJob.findMany({
        where,
        skip,
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.backgroundJob.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.backgroundJob.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Background job not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  async enqueue(dto: any, user: AuthUser) {
    const companyId = await this.resolveTargetCompanyId(user, dto.companyId);

    if (dto.idempotencyKey) {
      const existing = await this.prisma.backgroundJob.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
        if (!this.isTerminal(existing.status)) {
          return existing;
        }
        const replayed = await this.prisma.backgroundJob.update({
          where: { id: existing.id },
          data: {
            jobType: dto.jobType ?? existing.jobType,
            queueName: dto.queueName ?? existing.queueName,
            companyId: dto.companyId !== undefined ? (companyId ?? null) : existing.companyId,
            requestedById: user.id,
            status: 'QUEUED',
            priority: dto.priority ?? existing.priority,
            payload: dto.payload ?? existing.payload ?? undefined,
            result: Prisma.JsonNull,
            attempts: 0,
            maxAttempts: dto.maxAttempts ?? existing.maxAttempts,
            scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
            startedAt: null,
            completedAt: null,
            failedAt: null,
            errorMessage: null,
            correlationId: dto.correlationId ?? existing.correlationId,
          },
        });
        await this.auditLogs.log({
          action: 'BACKGROUND_JOB_REQUEUED',
          entityType: 'BackgroundJob',
          entityId: replayed.id,
          userId: user.id,
          severity: AuditSeverity.MEDIUM,
        });
        return replayed;
      }
    }

    const record = await this.prisma.backgroundJob.create({
      data: {
        jobNumber: 'JOB-' + Date.now(),
        jobType: dto.jobType,
        queueName: dto.queueName,
        companyId: companyId ?? null,
        requestedById: user.id,
        status: 'QUEUED',
        priority: dto.priority ?? 'NORMAL',
        payload: dto.payload ?? undefined,
        maxAttempts: dto.maxAttempts ?? 3,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        correlationId: dto.correlationId ?? null,
        idempotencyKey: dto.idempotencyKey ?? null,
      },
    });
    await this.auditLogs.log({
      action: 'BACKGROUND_JOB_ENQUEUED',
      entityType: 'BackgroundJob',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      severity: AuditSeverity.LOW,
    });
    return record;
  }

  async retry(id: string, user: AuthUser) {
    const job = await this.findOne(id, user);
    this.observabilityBudget.assertRetryAllowed(job);
    const record = await this.prisma.backgroundJob.update({
      where: { id },
      data: {
        status: 'QUEUED',
        attempts: job.status === BackgroundJobStatus.DEAD_LETTER ? 0 : job.attempts,
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorMessage: null,
      },
    });
    await this.auditLogs.log({
      action: 'BACKGROUND_JOB_RETRIED',
      entityType: 'BackgroundJob',
      entityId: id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      severity: AuditSeverity.MEDIUM,
    });
    return record;
  }

  async cancel(id: string, user: AuthUser) {
    const job = await this.findOne(id, user);
    this.observabilityBudget.assertCancelAllowed(job);
    const record = await this.prisma.backgroundJob.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.auditLogs.log({
      action: 'BACKGROUND_JOB_CANCELLED',
      entityType: 'BackgroundJob',
      entityId: id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      severity: AuditSeverity.MEDIUM,
    });
    return record;
  }

  async deadLetter(id: string, user: AuthUser) {
    await this.findOne(id, user);
    const record = await this.prisma.backgroundJob.update({
      where: { id },
      data: { status: 'DEAD_LETTER' },
    });
    await this.auditLogs.log({
      action: 'BACKGROUND_JOB_DEAD_LETTERED',
      entityType: 'BackgroundJob',
      entityId: id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      severity: AuditSeverity.HIGH,
    });
    return record;
  }

  async getStats(user: AuthUser, query: any = {}) {
    const companyWhere = (await this.companyScope.companyWhereFor(user, query.companyId)) as any;
    const statuses = [
      'QUEUED',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'RETRYING',
      'CANCELLED',
      'DEAD_LETTER',
    ];
    const counts = await Promise.all(
      statuses.map((status) =>
        this.prisma.backgroundJob.count({ where: { ...companyWhere, status: status as any } }),
      ),
    );
    return Object.fromEntries(statuses.map((s, i) => [s, counts[i]]));
  }

  private async resolveTargetCompanyId(user: AuthUser, requestedCompanyId?: string | null) {
    if (requestedCompanyId) {
      await this.companyScope.assertCanAccessCompany(user, requestedCompanyId, AccessLevel.WRITE);
      return requestedCompanyId;
    }

    if (!this.companyScope.isGroupScoped(user) && user.companyId) {
      await this.companyScope.assertCanAccessCompany(user, user.companyId, AccessLevel.WRITE);
      return user.companyId;
    }

    await this.companyScope.assertCanAccessCompany(user, undefined, AccessLevel.WRITE);
    return undefined;
  }

  private isTerminal(status: BackgroundJobStatus): boolean {
    const terminalStatuses: BackgroundJobStatus[] = [
      BackgroundJobStatus.COMPLETED,
      BackgroundJobStatus.FAILED,
      BackgroundJobStatus.CANCELLED,
      BackgroundJobStatus.DEAD_LETTER,
    ];
    return terminalStatuses.includes(status);
  }
}
