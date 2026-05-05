import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

function buildSelect(canDownload: boolean) {
  return {
    id: true,
    backupRunNumber: true,
    backupJobId: true,
    backupType: true,
    status: true,
    startedAt: true,
    completedAt: true,
    durationMs: true,
    fileSizeBytes: true,
    checksum: true,
    errorMessage: true,
    triggeredById: true,
    metadata: true,
    createdAt: true,
    ...(canDownload ? { filePath: true } : {}),
  };
}

function serializeBackupRun(record: Record<string, any>) {
  return {
    ...record,
    fileSizeBytes:
      record.fileSizeBytes === null || record.fileSizeBytes === undefined
        ? record.fileSizeBytes
        : record.fileSizeBytes.toString(),
  };
}

function hasPermission(user: any, perm: string): boolean {
  return Array.isArray(user?.permissions) && user.permissions.includes(perm);
}

@Injectable()
export class BackupRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user: any) {
    const { page = 1, limit = 20, backupJobId, status, backupType } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (backupJobId) where.backupJobId = backupJobId;
    if (status) where.status = status;
    if (backupType) where.backupType = backupType;
    const canDownload = hasPermission(user, 'backup_runs.download');

    const [data, total] = await Promise.all([
      this.prisma.backupRun.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        select: buildSelect(canDownload),
      }),
      this.prisma.backupRun.count({ where }),
    ]);
    return { data: data.map(serializeBackupRun), total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const canDownload = hasPermission(user, 'backup_runs.download');
    const record = await this.prisma.backupRun.findFirst({
      where: { id },
      select: buildSelect(canDownload),
    });
    if (!record) throw new NotFoundException('Backup run not found');
    return serializeBackupRun(record);
  }

  async create(dto: any, userId: string) {
    let backupType = dto.backupType;
    if (dto.backupJobId) {
      const job = await this.prisma.backupJob.findFirst({
        where: { id: dto.backupJobId, deletedAt: null },
        select: { id: true, backupType: true, status: true },
      });
      if (!job) throw new NotFoundException('Backup job not found');
      if (job.status !== 'ACTIVE') {
        throw new BadRequestException(`Backup job is ${job.status}; only ACTIVE jobs can run.`);
      }
      if (backupType && backupType !== job.backupType) {
        throw new BadRequestException('backupType must match the selected backup job');
      }
      backupType = job.backupType;
    }

    if (!backupType) {
      throw new BadRequestException('backupType is required when backupJobId is not supplied');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const backupRunNumber = `BR-${Date.now().toString(36).toUpperCase()}`;
      const record = await tx.backupRun.create({
        data: {
          backupRunNumber,
          backupJobId: dto.backupJobId,
          backupType,
          status: 'REQUESTED',
          triggeredById: userId,
          metadata: dto.metadata ?? {},
        },
        select: buildSelect(false),
      });
      // P0-06: Enqueue a BACKUP_RUN job so the worker actually performs
      // pg_dump. The job carries the backup-run id; the handler flips status
      // RUNNING -> COMPLETED/FAILED with file size + checksum.
      await tx.backgroundJob.create({
        data: {
          jobNumber: `JOB-BR-${Date.now().toString(36).toUpperCase()}`,
          jobType: 'BACKUP_RUN',
          queueName: 'backups',
          requestedById: userId,
          status: 'QUEUED',
          priority: 'NORMAL',
          payload: { backupRunId: (record as any).id },
          correlationId: (record as any).id,
          idempotencyKey: `BACKUP_RUN:${backupRunNumber}`,
        },
      });
      return record;
    });

    await this.auditLogs.log({
      action: 'BACKUP_RUN_CREATED',
      entityType: 'BackupRun',
      entityId: (result as any).id,
      userId,
      severity: AuditSeverity.MEDIUM,
    });
    return result;
  }

  async trigger(dto: any, userId: string) {
    return this.create({ ...dto, status: 'REQUESTED' }, userId);
  }
}
