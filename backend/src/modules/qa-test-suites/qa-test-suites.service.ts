import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class QaTestSuitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: any, userId: string) {
    const record = await this.prisma.qATestSuite.create({
      data: {
        suiteCode: dto.suiteCode ?? `QTS-${Date.now()}`,
        name: dto.name,
        description: dto.description,
        suiteType: dto.suiteType,
        moduleName: dto.moduleName,
        priority: dto.priority ?? 'MEDIUM',
        status: dto.status ?? 'ACTIVE',
        createdById: userId,
      },
    });
    await this.auditLogs.log({ action: 'QA_TEST_SUITE_CREATED', entityType: 'QATestSuite', entityId: record.id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, suiteType, status, moduleName, priority } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };
    if (suiteType) where.suiteType = suiteType;
    if (status) where.status = status;
    if (moduleName) where.moduleName = moduleName;
    if (priority) where.priority = priority;
    const [data, total] = await Promise.all([
      this.prisma.qATestSuite.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }),
      this.prisma.qATestSuite.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.qATestSuite.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { testCases: true } } },
    });
    if (!record) throw new NotFoundException('Test suite not found');
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.qATestSuite.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.moduleName !== undefined && { moduleName: dto.moduleName }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
      },
    });
    await this.auditLogs.log({ action: 'QA_TEST_SUITE_UPDATED', entityType: 'QATestSuite', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.qATestSuite.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: `QA_TEST_SUITE_${status}`, entityType: 'QATestSuite', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.qATestSuite.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'QA_TEST_SUITE_DELETED', entityType: 'QATestSuite', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return { success: true };
  }

  async getTestCases(suiteId: string, query: any) {
    const { page = 1, pageSize = 20 } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { testSuiteId: suiteId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.qATestCase.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }),
      this.prisma.qATestCase.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }
}
