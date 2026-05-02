import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class QaTestCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: any, userId: string) {
    const record = await this.prisma.qATestCase.create({
      data: {
        testCaseCode: `QTC-${Date.now()}`,
        testSuiteId: dto.testSuiteId,
        title: dto.title,
        description: dto.description,
        preconditions: dto.preconditions,
        steps: dto.steps ?? dto.testSteps ?? [],
        expectedResult: dto.expectedResult,
        testType: dto.testType,
        priority: dto.priority ?? 'MEDIUM',
        moduleName: dto.moduleName,
        status: dto.status ?? 'ACTIVE',
      },
    });
    await this.auditLogs.log({ action: 'QA_TEST_CASE_CREATED', entityType: 'QATestCase', entityId: record.id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, testSuiteId, status, priority, testType, moduleName } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };
    if (testSuiteId) where.testSuiteId = testSuiteId;
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (testType) where.testType = testType;
    if (moduleName) where.moduleName = moduleName;
    const [data, total] = await Promise.all([
      this.prisma.qATestCase.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }),
      this.prisma.qATestCase.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.qATestCase.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Test case not found');
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.qATestCase.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.preconditions !== undefined && { preconditions: dto.preconditions }),
        ...(dto.steps !== undefined && { steps: dto.steps }),
        ...(dto.expectedResult !== undefined && { expectedResult: dto.expectedResult }),
        ...(dto.testType !== undefined && { testType: dto.testType }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.moduleName !== undefined && { moduleName: dto.moduleName }),
      },
    });
    await this.auditLogs.log({ action: 'QA_TEST_CASE_UPDATED', entityType: 'QATestCase', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.qATestCase.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: `QA_TEST_CASE_${status}`, entityType: 'QATestCase', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.qATestCase.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'QA_TEST_CASE_DELETED', entityType: 'QATestCase', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return { success: true };
  }
}
