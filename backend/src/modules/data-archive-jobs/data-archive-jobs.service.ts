import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class DataArchiveJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { page = 1, limit = 20, companyId, status, dataCategory, retentionPolicyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    if (dataCategory) where.dataCategory = dataCategory;
    if (retentionPolicyId) where.retentionPolicyId = retentionPolicyId;

    const [data, total] = await Promise.all([
      this.prisma.dataArchiveJob.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.dataArchiveJob.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.dataArchiveJob.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Data archive job not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.dataArchiveJob.create({
      data: {
        archiveJobNumber: 'AJ-' + Date.now(),
        retentionPolicyId: dto.retentionPolicyId,
        companyId: dto.companyId,
        dataCategory: dto.dataCategory,
        status: 'DRAFT',
        metadata: dto.metadata ?? {},
        requestedById: userId,
      },
    });
    await this.auditLogs.log({ action: 'ARCHIVE_JOB_CREATED', entityType: 'DataArchiveJob', entityId: record.id, userId, severity: AuditSeverity.HIGH });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.dataArchiveJob.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata }),
        ...(dto.errorMessage !== undefined && { errorMessage: dto.errorMessage }),
      },
    });
    await this.auditLogs.log({ action: 'ARCHIVE_JOB_UPDATED', entityType: 'DataArchiveJob', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async approve(id: string, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.dataArchiveJob.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId },
    });
    await this.auditLogs.log({ action: 'ARCHIVE_JOB_APPROVED', entityType: 'DataArchiveJob', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.HIGH });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.dataArchiveJob.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'ARCHIVE_JOB_DELETED', entityType: 'DataArchiveJob', entityId: id, userId, severity: AuditSeverity.HIGH });
    return { success: true };
  }
}
