import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ScalabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const jobStatuses = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED', 'DEAD_LETTER'];

    const [jobCounts, queueConfigCount, cacheEntryCount, loadTestCounts] = await Promise.all([
      Promise.all(
        jobStatuses.map((status) =>
          this.prisma.backgroundJob.count({ where: { status: status as any } }),
        ),
      ),
      this.prisma.jobQueueConfig.count(),
      this.prisma.cacheEntry.count(),
      Promise.all([
        this.prisma.loadTestRun.count({ where: { deletedAt: null } }),
        this.prisma.loadTestRun.count({ where: { status: 'COMPLETED', deletedAt: null } }),
        this.prisma.loadTestRun.count({ where: { status: 'FAILED', deletedAt: null } }),
        this.prisma.loadTestRun.count({ where: { status: 'RUNNING', deletedAt: null } }),
      ]),
    ]);

    return {
      jobQueueCounts: Object.fromEntries(jobStatuses.map((s, i) => [s, jobCounts[i]])),
      queueConfigCount,
      cacheEntryCount,
      loadTests: {
        total: loadTestCounts[0],
        completed: loadTestCounts[1],
        failed: loadTestCounts[2],
        running: loadTestCounts[3],
      },
    };
  }
}
