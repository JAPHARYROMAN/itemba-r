import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class DataIsolationIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, pageSize = 20, status, severity, issueType } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (issueType) where.issueType = issueType;

    const [data, total] = await Promise.all([
      this.prisma.dataIsolationTestIssue.findMany({
        where,
        skip,
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dataIsolationTestIssue.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.dataIsolationTestIssue.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Data isolation issue not found');
    return record;
  }

  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.dataIsolationTestIssue.update({
      where: { id },
      data: { status: status as any },
    });
    await this.auditLogs.log({
      action: `DATA_ISOLATION_ISSUE_${status}`,
      entityType: 'DataIsolationTestIssue',
      entityId: id,
      userId,
      severity: AuditSeverity.MEDIUM,
    });
    return record;
  }
}
