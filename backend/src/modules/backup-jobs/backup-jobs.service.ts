import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const SAFE_SELECT = {
  id: true,
  backupJobCode: true,
  name: true,
  backupType: true,
  schedule: true,
  scheduleConfig: true,
  storageTarget: true,
  retentionDays: true,
  status: true,
  lastRunAt: true,
  nextRunAt: true,
  createdById: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class BackupJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, limit = 20, backupType, status, schedule } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (backupType) where.backupType = backupType;
    if (status) where.status = status;
    if (schedule) where.schedule = schedule;

    const [data, total] = await Promise.all([
      this.prisma.backupJob.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, select: SAFE_SELECT }),
      this.prisma.backupJob.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.backupJob.findFirst({ where: { id, deletedAt: null }, select: SAFE_SELECT });
    if (!record) throw new NotFoundException('Backup job not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.backupJob.create({
      data: {
        backupJobCode: 'BJ-' + Date.now(),
        name: dto.name,
        backupType: dto.backupType,
        schedule: dto.schedule ?? 'MANUAL',
        scheduleConfig: dto.scheduleConfig ?? {},
        storageTarget: dto.storageTarget,
        storageConfigEncrypted: dto.storageConfigEncrypted ?? '',
        retentionDays: dto.retentionDays ?? 30,
        status: dto.status ?? 'ACTIVE',
        createdById: userId,
      },
      select: SAFE_SELECT,
    });
    await this.auditLogs.log({ action: 'BACKUP_JOB_CREATED', entityType: 'BackupJob', entityId: (record as any).id, userId, severity: AuditSeverity.HIGH });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.backupJob.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.schedule !== undefined && { schedule: dto.schedule }),
        ...(dto.scheduleConfig !== undefined && { scheduleConfig: dto.scheduleConfig }),
        ...(dto.storageTarget !== undefined && { storageTarget: dto.storageTarget }),
        ...(dto.storageConfigEncrypted !== undefined && { storageConfigEncrypted: dto.storageConfigEncrypted }),
        ...(dto.retentionDays !== undefined && { retentionDays: dto.retentionDays }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.lastRunAt !== undefined && { lastRunAt: new Date(dto.lastRunAt) }),
        ...(dto.nextRunAt !== undefined && { nextRunAt: new Date(dto.nextRunAt) }),
      },
      select: SAFE_SELECT,
    });
    await this.auditLogs.log({ action: 'BACKUP_JOB_UPDATED', entityType: 'BackupJob', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.backupJob.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'BACKUP_JOB_DELETED', entityType: 'BackupJob', entityId: id, userId, oldValue: existing as any, severity: AuditSeverity.HIGH });
    return { success: true };
  }
}
