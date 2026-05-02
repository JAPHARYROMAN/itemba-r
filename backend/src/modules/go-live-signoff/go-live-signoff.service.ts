import { Injectable } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class GoLiveSignoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async signoff(dto: any, userId: string) {
    await this.auditLogs.log({
      action: 'GO_LIVE_SIGNOFF',
      entityType: 'GoLiveSignoff',
      entityId: 'signoff',
      userId,
      severity: AuditSeverity.CRITICAL,
      metadata: { notes: dto.notes, environment: dto.environment, assessmentId: dto.assessmentId } as any,
    });

    if (dto.assessmentId) {
      await this.prisma.launchReadinessAssessment.update({
        where: { id: dto.assessmentId },
        data: { approvedById: userId, approvedAt: new Date() },
      });
    }

    return {
      success: true,
      message: 'Go-live sign-off recorded successfully',
      signedOffBy: userId,
      signedOffAt: new Date(),
      environment: dto.environment,
      notes: dto.notes,
    };
  }
}
