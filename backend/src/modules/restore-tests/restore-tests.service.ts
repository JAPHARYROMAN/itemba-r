import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class RestoreTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, limit = 20, backupRunId, status, testType } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (backupRunId) where.backupRunId = backupRunId;
    if (status) where.status = status;
    if (testType) where.testType = testType;

    const [data, total] = await Promise.all([
      this.prisma.restoreTest.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.restoreTest.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.restoreTest.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Restore test not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.restoreTest.create({
      data: {
        restoreTestNumber: 'RT-' + Date.now(),
        backupRunId: dto.backupRunId,
        testDate: dto.testDate ? new Date(dto.testDate) : new Date(),
        testType: dto.testType,
        status: dto.status ?? 'PLANNED',
        testedById: userId,
        resultSummary: dto.resultSummary,
        issuesFound: dto.issuesFound,
        correctiveActions: dto.correctiveActions,
      },
    });
    await this.auditLogs.log({
      action: 'RESTORE_TEST_CREATED',
      entityType: 'RestoreTest',
      entityId: record.id,
      userId,
      severity: AuditSeverity.MEDIUM,
    });
    return record;
  }

  /**
   * P0-06 (cont.): Trigger automated checksum verification of an existing
   * BackupRun. Creates a `CHECKSUM_VERIFY` RestoreTest in PLANNED state and
   * enqueues a CUSTOM-typed BackgroundJob whose payload is consumed by the
   * `RestoreTestJobHandler`. The handler re-hashes the file at
   * `BackupRun.filePath`, compares to `BackupRun.checksum`, and flips the
   * RestoreTest to PASSED/FAILED with a result summary.
   *
   * Idempotency: per-backup `idempotencyKey` (`RT-VERIFY-<backupRunNumber>`)
   * means re-submitting against the same backup returns the existing job
   * rather than running twice.
   */
  async verifyBackup(backupRunId: string, userId: string) {
    const backupRun = await this.prisma.backupRun.findFirst({
      where: { id: backupRunId },
    });
    if (!backupRun) throw new NotFoundException('BackupRun not found');
    if (backupRun.status !== 'COMPLETED') {
      throw new BadRequestException(
        `BackupRun ${backupRun.backupRunNumber} is in status ${backupRun.status}; verification only runs on COMPLETED backups.`,
      );
    }

    const idempotencyKey = `RT-VERIFY-${backupRun.backupRunNumber}`;
    const existingJob = await this.prisma.backgroundJob.findUnique({
      where: { idempotencyKey },
      select: { correlationId: true },
    });
    if (existingJob?.correlationId) {
      const existingTest = await this.prisma.restoreTest.findFirst({
        where: { id: existingJob.correlationId, deletedAt: null },
      });
      if (existingTest) {
        return existingTest;
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const test = await tx.restoreTest.create({
        data: {
          restoreTestNumber: `RT-${Date.now().toString(36).toUpperCase()}`,
          backupRunId,
          testDate: new Date(),
          testType: 'CHECKSUM_VERIFY',
          status: 'PLANNED',
          testedById: userId,
        },
      });
      await tx.backgroundJob.create({
        data: {
          jobNumber: `JOB-RT-${Date.now().toString(36).toUpperCase()}`,
          jobType: 'CUSTOM',
          queueName: 'restore-tests',
          requestedById: userId,
          status: 'QUEUED',
          priority: 'NORMAL',
          payload: { kind: 'RESTORE_TEST', restoreTestId: test.id, backupRunId },
          correlationId: test.id,
          idempotencyKey,
        },
      });
      return test;
    });

    await this.auditLogs.log({
      action: 'RESTORE_TEST_REQUESTED',
      entityType: 'RestoreTest',
      entityId: result.id,
      userId,
      severity: AuditSeverity.MEDIUM,
      newValue: { backupRunId, testType: 'CHECKSUM_VERIFY' } as any,
    });
    return result;
  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.restoreTest.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.startedAt !== undefined && { startedAt: new Date(dto.startedAt) }),
        ...(dto.completedAt !== undefined && { completedAt: new Date(dto.completedAt) }),
        ...(dto.resultSummary !== undefined && { resultSummary: dto.resultSummary }),
        ...(dto.issuesFound !== undefined && { issuesFound: dto.issuesFound }),
        ...(dto.correctiveActions !== undefined && { correctiveActions: dto.correctiveActions }),
      },
    });
    await this.auditLogs.log({
      action: 'RESTORE_TEST_UPDATED',
      entityType: 'RestoreTest',
      entityId: id,
      userId,
      oldValue: existing as any,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.restoreTest.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'RESTORE_TEST_DELETED',
      entityType: 'RestoreTest',
      entityId: id,
      userId,
      severity: AuditSeverity.MEDIUM,
    });
    return { success: true };
  }
}
