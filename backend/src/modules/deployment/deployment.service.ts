import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DeploymentService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const statuses = ['PLANNED', 'BUILDING', 'DEPLOYED', 'FAILED', 'ROLLED_BACK', 'CANCELLED'];

    const [statusCounts, recentReleases, lastProduction] = await Promise.all([
      Promise.all(
        statuses.map((status) =>
          this.prisma.deploymentRelease.count({
            where: { status: status as any, deletedAt: null },
          }),
        ),
      ),
      this.prisma.deploymentRelease.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.deploymentRelease.findFirst({
        where: { environment: 'PRODUCTION', status: 'DEPLOYED', deletedAt: null },
        orderBy: { deployedAt: 'desc' },
      }),
    ]);

    return {
      releasesByStatus: Object.fromEntries(statuses.map((s, i) => [s, statusCounts[i]])),
      recentReleases,
      lastProductionDeploy: lastProduction,
    };
  }
}
