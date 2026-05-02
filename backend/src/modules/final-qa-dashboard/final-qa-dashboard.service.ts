import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FinalQaDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      openCriticalBlockers,
      totalResults,
      passedResults,
      openSecurityCritical,
      openAccountingCritical,
      latestAssessment,
      publishedManuals,
      publishedArticles,
      activeCourses,
      totalEnrollments,
      openTickets,
    ] = await Promise.all([
      this.prisma.launchBlocker.count({ where: { status: 'OPEN', severity: 'CRITICAL', deletedAt: null } }),
      this.prisma.qATestResult.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.qATestResult.count({ where: { status: 'PASSED', createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.launchBlocker.count({ where: { status: 'OPEN', blockerType: 'SECURITY_RISK', severity: 'CRITICAL', deletedAt: null } }),
      this.prisma.launchBlocker.count({ where: { status: 'OPEN', blockerType: 'ACCOUNTING_ISSUE', severity: 'CRITICAL', deletedAt: null } }),
      this.prisma.launchReadinessAssessment.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } }),
      this.prisma.userManual.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
      this.prisma.helpArticle.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
      this.prisma.trainingCourse.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.trainingEnrollment.count({ where: {} }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN', deletedAt: null } }),
    ]);

    const qaPassRate = totalResults > 0 ? Math.round((passedResults / totalResults) * 100) : 0;
    const securityReviewPassed = openSecurityCritical === 0;
    const accountingReviewPassed = openAccountingCritical === 0;

    let goLiveRecommendation: string;
    if (openCriticalBlockers > 0) goLiveRecommendation = 'NOT_READY';
    else if (!securityReviewPassed || !accountingReviewPassed || qaPassRate < 70) goLiveRecommendation = 'READY_WITH_RISKS';
    else goLiveRecommendation = 'READY';

    return {
      openCriticalBlockers,
      qaPassRate,
      securityReviewPassed,
      accountingReviewPassed,
      latestAssessment,
      publishedManuals,
      publishedArticles,
      activeCourses,
      totalEnrollments,
      openTickets,
      goLiveRecommendation,
    };
  }
}
