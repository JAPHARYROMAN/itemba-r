import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditScopeKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AddDataIsolationIssueDto,
  CompleteDataIsolationTestDto,
  CreateDataIsolationTestDto,
} from './dto/data-isolation-test.dto';

@Injectable()
export class DataIsolationTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    // Cross-company audit tooling: require GROUP-scoped role.
    this.companyScope.assertGroupScoped(user, 'view data isolation test runs');
    const { page = 1, pageSize = 20, runType, status } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = {};
    if (runType) where.runType = runType;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.dataIsolationTestRun.findMany({
        where,
        skip,
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dataIsolationTestRun.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string, user?: AuthUser) {
    if (user) this.companyScope.assertGroupScoped(user, 'view data isolation test runs');
    const record = await this.prisma.dataIsolationTestRun.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Data isolation test run not found');
    return record;
  }

  async getIssues(testRunId: string, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'view data isolation test issues');
    await this.findOne(testRunId);
    return this.prisma.dataIsolationTestIssue.findMany({
      where: { testRunId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateDataIsolationTestDto, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'run data isolation tests');
    const record = await this.prisma.dataIsolationTestRun.create({
      data: {
        testRunNumber: 'ISO-' + Date.now(),
        runType: dto.runType,
        status: 'RUNNING',
        startedById: user.id,
        startedAt: new Date(),
        totalChecks: dto.totalChecks ?? 0,
      },
    });
    await this.auditLogs.log({
      action: 'DATA_ISOLATION_TEST_CREATED',
      entityType: 'DataIsolationTestRun',
      entityId: record.id,
      userId: user.id,
      scopeKind: AuditScopeKind.GLOBAL,
      companyScopeIds: [],
      newValue: record as unknown as Record<string, unknown>,
    });
    return record;
  }

  async complete(id: string, dto: CompleteDataIsolationTestDto, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'complete data isolation tests');
    await this.findOne(id);
    const failedChecks = Number(dto.failedChecks ?? 0);
    const passedChecks = Number(dto.passedChecks ?? 0);
    let status: 'PASSED' | 'FAILED' | 'PARTIAL';
    if (failedChecks === 0) {
      status = 'PASSED';
    } else if (passedChecks === 0) {
      status = 'FAILED';
    } else {
      status = 'PARTIAL';
    }
    const record = await this.prisma.dataIsolationTestRun.update({
      where: { id },
      data: {
        status,
        completedAt: new Date(),
        failedChecks,
        passedChecks,
        resultSummary: (dto.resultSummary as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
    await this.auditLogs.log({
      action: 'DATA_ISOLATION_TEST_COMPLETED',
      entityType: 'DataIsolationTestRun',
      entityId: id,
      userId: user.id,
      scopeKind: AuditScopeKind.GLOBAL,
      companyScopeIds: [],
      newValue: record as unknown as Record<string, unknown>,
    });
    return record;
  }

  async addIssue(testRunId: string, dto: AddDataIsolationIssueDto, user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'add data isolation test issues');
    await this.findOne(testRunId);
    const record = await this.prisma.dataIsolationTestIssue.create({
      data: {
        testRunId,
        issueType: dto.issueType,
        severity: dto.severity,
        entityType: dto.entityType ?? null,
        endpoint: dto.endpoint ?? null,
        description: dto.description,
        status: 'OPEN',
      },
    });
    await this.auditLogs.log({
      action: 'DATA_ISOLATION_ISSUE_CREATED',
      entityType: 'DataIsolationTestIssue',
      entityId: record.id,
      userId: user.id,
      scopeKind: AuditScopeKind.GLOBAL,
      companyScopeIds: [],
      newValue: record as unknown as Record<string, unknown>,
    });
    return record;
  }
}
