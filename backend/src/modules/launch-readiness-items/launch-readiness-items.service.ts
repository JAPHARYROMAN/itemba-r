import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class LaunchReadinessItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findOne(id: string) {
    const record = await this.prisma.launchReadinessItem.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Readiness item not found');
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.launchReadinessItem.update({
      where: { id },
      data: {
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.responsibleUserId !== undefined && { responsibleUserId: dto.responsibleUserId }),
      },
    });
    await this.auditLogs.log({ action: 'LAUNCH_READINESS_ITEM_UPDATED', entityType: 'LaunchReadinessItem', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async setStatus(id: string, status: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.launchReadinessItem.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: `LAUNCH_READINESS_ITEM_${status}`, entityType: 'LaunchReadinessItem', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async markPassed(id: string, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.launchReadinessItem.update({
      where: { id },
      data: { status: 'PASSED', completedById: userId, completedAt: new Date() },
    });
    await this.auditLogs.log({ action: 'LAUNCH_READINESS_ITEM_PASSED', entityType: 'LaunchReadinessItem', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async waive(id: string, dto: any, userId: string) {
    if (!dto.notes) throw new BadRequestException('notes is required to waive a readiness item');
    await this.findOne(id);
    const record = await this.prisma.launchReadinessItem.update({
      where: { id },
      data: { status: 'WAIVED', notes: dto.notes },
    });
    await this.auditLogs.log({ action: 'LAUNCH_READINESS_ITEM_WAIVED', entityType: 'LaunchReadinessItem', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }
}
