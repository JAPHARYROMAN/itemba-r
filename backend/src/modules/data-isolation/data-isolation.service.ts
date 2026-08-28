import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';

@Injectable()
export class DataIsolationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getDashboard(user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'view the data isolation dashboard');
    const [total, passed, failed, partial, openIssues, recentRuns] = await Promise.all([
      this.prisma.dataIsolationTestRun.count(),
      this.prisma.dataIsolationTestRun.count({ where: { status: 'PASSED' } }),
      this.prisma.dataIsolationTestRun.count({ where: { status: 'FAILED' } }),
      this.prisma.dataIsolationTestRun.count({ where: { status: 'PARTIAL' } }),
      this.prisma.dataIsolationTestIssue.groupBy({
        by: ['severity'],
        where: { status: 'OPEN' },
        _count: { id: true },
      }),
      this.prisma.dataIsolationTestRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    return {
      totalTestRuns: total,
      passed,
      failed,
      partial,
      openIssuesBySeverity: openIssues.map((r) => ({
        severity: r.severity,
        count: r._count.id,
      })),
      recentTestRuns: recentRuns,
    };
  }
}
