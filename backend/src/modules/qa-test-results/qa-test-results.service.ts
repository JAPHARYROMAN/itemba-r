import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class QaTestResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, pageSize = 20, testRunId, status } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = {};
    if (testRunId) where.testRunId = testRunId;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.qATestResult.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }),
      this.prisma.qATestResult.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.qATestResult.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Test result not found');
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.qATestResult.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.actualResult !== undefined && { actualResult: dto.actualResult }),
        ...(dto.failureReason !== undefined && { failureReason: dto.failureReason }),
        ...(dto.evidenceDocumentId !== undefined && { evidenceDocumentId: dto.evidenceDocumentId }),
        ...(dto.screenshotUrl !== undefined && { screenshotUrl: dto.screenshotUrl }),
        executedById: userId,
        executedAt: new Date(),
      },
    });
    await this.auditLogs.log({ action: 'QA_TEST_RESULT_UPDATED', entityType: 'QATestResult', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async createBlocker(resultId: string, dto: any, userId: string) {
    const result = await this.prisma.qATestResult.findFirst({
      where: { id: resultId },
      include: { testCase: true },
    });
    if (!result) throw new NotFoundException('Test result not found');

    const blocker = await this.prisma.launchBlocker.create({
      data: {
        blockerNumber: `LB-${Date.now()}`,
        title: dto.title ?? `Blocker from test case ${result.testCaseId}`,
        description: dto.description ?? result.failureReason ?? '',
        severity: result.testCase?.priority ?? 'MEDIUM',
        blockerType: dto.blockerType ?? 'BUG',
        moduleName: result.testCase?.moduleName,
        status: 'OPEN',
        reportedById: userId,
        relatedEntityId: resultId,
        relatedEntityType: 'QATestResult',
      },
    });
    await this.auditLogs.log({ action: 'LAUNCH_BLOCKER_CREATED_FROM_TEST', entityType: 'LaunchBlocker', entityId: blocker.id, userId, severity: AuditSeverity.HIGH });
    return blocker;
  }
}
