import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateJobQueueConfigDto, UpdateJobQueueConfigDto } from './dto/job-queue-config.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { assertCanAccessCompanyFromUser } from '../../common/services';

@Injectable()
export class JobQueueConfigsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll() {
    return this.prisma.jobQueueConfig.findMany({ orderBy: { queueName: 'asc' } });
  }

  async findOne(id: string) {
    const record = await this.prisma.jobQueueConfig.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Job queue config not found');
    return record;
  }

  async create(dto: CreateJobQueueConfigDto, userId: string) {
    const record = await this.prisma.jobQueueConfig.create({
      data: {
        queueName: dto.queueName,
        description: dto.description ?? null,
        concurrency: dto.concurrency ?? 1,
        retryAttempts: dto.retryAttempts ?? 3,
        retryBackoffSeconds: dto.retryBackoffSeconds ?? 60,
        timeoutSeconds: dto.timeoutSeconds ?? null,
        isActive: dto.isActive ?? true,
      },
    });
    await this.auditLogs.log({
      action: 'JOB_QUEUE_CONFIG_CREATED',
      entityType: 'JobQueueConfig',
      entityId: record.id,
      userId,
      companyId: null,
      newValue: record as unknown as Record<string, unknown>,
    });
    return record;
  }

  async update(id: string, dto: UpdateJobQueueConfigDto, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.jobQueueConfig.update({
      where: { id },
      data: {
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.concurrency !== undefined && { concurrency: dto.concurrency }),
        ...(dto.retryAttempts !== undefined && { retryAttempts: dto.retryAttempts }),
        ...(dto.retryBackoffSeconds !== undefined && {
          retryBackoffSeconds: dto.retryBackoffSeconds,
        }),
        ...(dto.timeoutSeconds !== undefined && { timeoutSeconds: dto.timeoutSeconds }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    await this.auditLogs.log({
      action: 'JOB_QUEUE_CONFIG_UPDATED',
      entityType: 'JobQueueConfig',
      entityId: id,
      userId,
      companyId: null,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: record as unknown as Record<string, unknown>,
    });
    return record;
  }

  async setActive(id: string, isActive: boolean, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.jobQueueConfig.update({ where: { id }, data: { isActive } });
    await this.auditLogs.log({
      action: isActive ? 'JOB_QUEUE_CONFIG_ACTIVATED' : 'JOB_QUEUE_CONFIG_DEACTIVATED',
      entityType: 'JobQueueConfig',
      entityId: id,
      userId,
      companyId: null,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: record as unknown as Record<string, unknown>,
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, null, AccessLevel.MANAGE);
    const existing = await this.findOne(id);
    await this.prisma.jobQueueConfig.delete({ where: { id } });
    await this.auditLogs.log({
      action: 'JOB_QUEUE_CONFIG_DELETED',
      entityType: 'JobQueueConfig',
      entityId: id,
      userId: user.id,
      companyId: null,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { success: true };
  }
}
