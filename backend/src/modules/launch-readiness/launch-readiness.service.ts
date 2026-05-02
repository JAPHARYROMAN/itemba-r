import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LaunchReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardSummary() {
    const [
      latestAssessment,
      openBlockers,
      criticalBlockers,
      highBlockers,
      acceptedRisks,
      recentReadinessItems,
      blockersByModule,
      blockersBySeverity,
    ] = await Promise.all([
      this.prisma.launchReadinessAssessment.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.launchBlocker.count({ where: { status: 'OPEN', deletedAt: null } }),
      this.prisma.launchBlocker.count({ where: { status: 'OPEN', severity: 'CRITICAL', deletedAt: null } }),
      this.prisma.launchBlocker.count({ where: { status: 'OPEN', severity: 'HIGH', deletedAt: null } }),
      this.prisma.launchBlocker.count({ where: { status: 'ACCEPTED_RISK', deletedAt: null } }),
      this.prisma.launchReadinessItem.findMany({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.launchBlocker.groupBy({
        by: ['moduleName'],
        where: { status: 'OPEN', deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.launchBlocker.groupBy({
        by: ['severity'],
        where: { status: 'OPEN', deletedAt: null },
        _count: { id: true },
      }),
    ]);

    return {
      readinessStatus: latestAssessment?.status ?? 'NOT_ASSESSED',
      latestAssessment,
      overallScore: latestAssessment?.overallScore ?? 0,
      openBlockers,
      criticalBlockers,
      highBlockers,
      acceptedRisks,
      recentReadinessItems,
      blockersByModule,
      blockersBySeverity,
    };
  }
}
