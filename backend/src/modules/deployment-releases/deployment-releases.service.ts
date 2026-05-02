import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class DeploymentReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, pageSize = 20, environment, status } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };
    if (environment) where.environment = environment;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.deploymentRelease.findMany({
        where,
        skip,
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.deploymentRelease.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.deploymentRelease.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Deployment release not found');
    return record;
  }

  async create(dto: any, userId: string) {
    return this.prisma.deploymentRelease.create({
      data: {
        releaseNumber: 'REL-' + Date.now(),
        version: dto.version,
        environment: dto.environment,
        status: 'PLANNED',
        commitHash: dto.commitHash ?? null,
        imageTag: dto.imageTag ?? null,
        migrationStatus: dto.migrationStatus ?? 'NOT_REQUIRED',
        notes: dto.notes ?? null,
      },
    });
  }

  async update(id: string, dto: any) {
    await this.findOne(id);
    return this.prisma.deploymentRelease.update({
      where: { id },
      data: {
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.imageTag !== undefined && { imageTag: dto.imageTag }),
        ...(dto.commitHash !== undefined && { commitHash: dto.commitHash }),
      },
    });
  }

  async deploy(id: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.deploymentRelease.update({
      where: { id },
      data: { status: 'DEPLOYED', deployedAt: new Date(), deployedById: userId },
    });
    await this.auditLogs.log({
      action: 'DEPLOYMENT_RELEASE_DEPLOYED',
      entityType: 'DeploymentRelease',
      entityId: id,
      userId,
      severity: AuditSeverity.HIGH,
    });
    return record;
  }

  async fail(id: string) {
    await this.findOne(id);
    return this.prisma.deploymentRelease.update({
      where: { id },
      data: { status: 'FAILED' },
    });
  }

  async rollback(id: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.deploymentRelease.update({
      where: { id },
      data: { status: 'ROLLED_BACK', rollbackAt: new Date(), rollbackById: userId },
    });
    await this.auditLogs.log({
      action: 'DEPLOYMENT_RELEASE_ROLLED_BACK',
      entityType: 'DeploymentRelease',
      entityId: id,
      userId,
      severity: AuditSeverity.CRITICAL,
    });
    return record;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.deploymentRelease.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }
}
