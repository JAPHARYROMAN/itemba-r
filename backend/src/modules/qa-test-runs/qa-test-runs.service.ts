import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class QaTestRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: any, userId: string) {
    const record = await this.prisma.qATestRun.create({
      data: {
        testRunNumber: `QTR-${Date.now()}`,
        testSuiteId: dto.testSuiteId,
        runName: dto.runName ?? dto.name ?? 'Test Run',
        environment: dto.environment ?? 'TEST',
        status: 'PLANNED',
        startedById: userId,
        startedAt: new Date(),
        totalCases: dto.totalCases ?? 0,
        passedCases: 0,
        failedCases: 0,
        blockedCases: 0,
        skippedCases: 0,
      },
    });
    await this.auditLogs.log({ action: 'QA_TEST_RUN_CREATED', entityType: 'QATestRun', entityId: record.id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, status, environment, testSuiteId } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (environment) where.environment = environment;
    if (testSuiteId) where.testSuiteId = testSuiteId;
    const [data, total] = await Promise.all([
      this.prisma.qATestRun.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }),
      this.prisma.qATestRun.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.qATestRun.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { testResults: true } } },
    });
    if (!record) throw new NotFoundException('Test run not found');
    return record;
  }

  async start(id: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.qATestRun.update({ where: { id }, data: { status: 'RUNNING' } });
    await this.auditLogs.log({ action: 'QA_TEST_RUN_STARTED', entityType: 'QATestRun', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async complete(id: string, userId: string) {
    const run = await this.findOne(id);
    const failedCases = run.failedCases ?? 0;
    const blockedCases = run.blockedCases ?? 0;
    let status = 'PASSED';
    if (failedCases > 0) status = 'FAILED';
    else if (blockedCases > 0) status = 'PARTIAL';
    const record = await this.prisma.qATestRun.update({ where: { id }, data: { status: status as any, completedAt: new Date() } });
    await this.auditLogs.log({ action: 'QA_TEST_RUN_COMPLETED', entityType: 'QATestRun', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async cancel(id: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.qATestRun.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.auditLogs.log({ action: 'QA_TEST_RUN_CANCELLED', entityType: 'QATestRun', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async addResult(runId: string, dto: any, userId: string) {
    await this.findOne(runId);
    const result = await this.prisma.qATestResult.create({
      data: {
        testRunId: runId,
        testCaseId: dto.testCaseId,
        status: dto.status ?? 'NOT_RUN',
        actualResult: dto.actualResult,
        failureReason: dto.failureReason,
        screenshotUrl: dto.screenshotUrl,
        evidenceDocumentId: dto.evidenceDocumentId,
        executedById: userId,
        executedAt: new Date(),
      },
    });
    // recalculate counts
    const [passed, failed, blocked, skipped, total] = await Promise.all([
      this.prisma.qATestResult.count({ where: { testRunId: runId, status: 'PASSED' } }),
      this.prisma.qATestResult.count({ where: { testRunId: runId, status: 'FAILED' } }),
      this.prisma.qATestResult.count({ where: { testRunId: runId, status: 'BLOCKED' } }),
      this.prisma.qATestResult.count({ where: { testRunId: runId, status: 'SKIPPED' } }),
      this.prisma.qATestResult.count({ where: { testRunId: runId } }),
    ]);
    await this.prisma.qATestRun.update({
      where: { id: runId },
      data: { passedCases: passed, failedCases: failed, blockedCases: blocked, skippedCases: skipped, totalCases: total },
    });
    await this.auditLogs.log({ action: 'QA_TEST_RESULT_ADDED', entityType: 'QATestResult', entityId: result.id, userId, severity: AuditSeverity.LOW });
    return result;
  }

  async getResults(runId: string, query: any) {
    const { page = 1, pageSize = 20 } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const [data, total] = await Promise.all([
      this.prisma.qATestResult.findMany({ where: { testRunId: runId }, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }),
      this.prisma.qATestResult.count({ where: { testRunId: runId } }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }
}
