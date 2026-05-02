import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
@Injectable()
export class GuidedWalkthroughsService {
  constructor(private readonly prisma: PrismaService, private readonly auditLogs: AuditLogsService) {}
  async create(dto: any, userId: string) {
    const record = await this.prisma.guidedWalkthrough.create({ data: { walkthroughCode: 'GW-' + Date.now(), title: dto.title, description: dto.description, routePath: dto.routePath, steps: dto.steps, moduleName: dto.moduleName, roleName: dto.roleName, status: 'DRAFT', createdById: userId } });
    await this.auditLogs.log({ action: 'GUIDED_WALKTHROUGH_CREATED', entityType: 'GuidedWalkthrough', entityId: record.id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async findAll(query: any) {
    const { page = 1, pageSize = 20, status, moduleName, roleName } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (moduleName) where.moduleName = moduleName;
    if (roleName) where.roleName = roleName;
    const [data, total] = await Promise.all([this.prisma.guidedWalkthrough.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }), this.prisma.guidedWalkthrough.count({ where })]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }
  async findOne(id: string) {
    const record = await this.prisma.guidedWalkthrough.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Guided walkthrough not found');
    return record;
  }
  async findByRoute(routePath: string) {
    return this.prisma.guidedWalkthrough.findFirst({ where: { routePath, status: 'ACTIVE', deletedAt: null } });
  }
  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.guidedWalkthrough.update({ where: { id }, data: { ...(dto.title !== undefined && { title: dto.title }), ...(dto.description !== undefined && { description: dto.description }), ...(dto.routePath !== undefined && { routePath: dto.routePath }), ...(dto.steps !== undefined && { steps: dto.steps }), ...(dto.moduleName !== undefined && { moduleName: dto.moduleName }), ...(dto.roleName !== undefined && { roleName: dto.roleName }) } });
    await this.auditLogs.log({ action: 'GUIDED_WALKTHROUGH_UPDATED', entityType: 'GuidedWalkthrough', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.guidedWalkthrough.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: 'GUIDED_WALKTHROUGH_' + status, entityType: 'GuidedWalkthrough', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }
  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.guidedWalkthrough.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'GUIDED_WALKTHROUGH_DELETED', entityType: 'GuidedWalkthrough', entityId: id, userId, severity: AuditSeverity.LOW });
    return { success: true };
  }
  async startProgress(walkthroughId: string, userId: string) {
    const existing = await this.prisma.userWalkthroughProgress.findFirst({ where: { userId, guidedWalkthroughId: walkthroughId } });
    if (existing) {
      return this.prisma.userWalkthroughProgress.update({ where: { id: existing.id }, data: { status: 'IN_PROGRESS' } });
    }
    return this.prisma.userWalkthroughProgress.create({ data: { userId, guidedWalkthroughId: walkthroughId, status: 'IN_PROGRESS', currentStep: 1 } });
  }
  async stepProgress(walkthroughId: string, userId: string) {
    const progress = await this.prisma.userWalkthroughProgress.findFirst({ where: { userId, guidedWalkthroughId: walkthroughId } });
    if (!progress) throw new NotFoundException('Walkthrough progress not found');
    return this.prisma.userWalkthroughProgress.update({ where: { id: progress.id }, data: { currentStep: { increment: 1 } } });
  }
  async completeProgress(walkthroughId: string, userId: string) {
    const progress = await this.prisma.userWalkthroughProgress.findFirst({ where: { userId, guidedWalkthroughId: walkthroughId } });
    if (!progress) throw new NotFoundException('Walkthrough progress not found');
    return this.prisma.userWalkthroughProgress.update({ where: { id: progress.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
  }
  async dismissProgress(walkthroughId: string, userId: string) {
    const progress = await this.prisma.userWalkthroughProgress.findFirst({ where: { userId, guidedWalkthroughId: walkthroughId } });
    if (!progress) throw new NotFoundException('Walkthrough progress not found');
    return this.prisma.userWalkthroughProgress.update({ where: { id: progress.id }, data: { status: 'DISMISSED' } });
  }
}
