import { Injectable } from '@nestjs/common';
import { HelpArticleStatus, UserManualStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

@Injectable()
export class DocumentationService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const staleCutoff = daysBefore(new Date(), 90);

    const [
      totalManuals,
      publishedManuals,
      reviewedManuals,
      draftManuals,
      totalArticles,
      publishedArticles,
      draftArticles,
      archivedArticles,
      activeWalkthroughs,
      totalWalkthroughs,
      manualStatusRows,
      articleStatusRows,
      manualsByModuleRows,
      articlesByCategoryRows,
      walkthroughStatusRows,
      articleEngagement,
      staleManualDrafts,
      staleArticleDrafts,
      recentManuals,
      recentArticles,
      popularArticles,
    ] = await Promise.all([
      this.prisma.userManual.count({ where: { deletedAt: null } }),
      this.prisma.userManual.count({
        where: { status: UserManualStatus.PUBLISHED, deletedAt: null },
      }),
      this.prisma.userManual.count({
        where: { status: UserManualStatus.REVIEWED, deletedAt: null },
      }),
      this.prisma.userManual.count({
        where: { status: UserManualStatus.DRAFT, deletedAt: null },
      }),
      this.prisma.helpArticle.count({ where: { deletedAt: null } }),
      this.prisma.helpArticle.count({
        where: { status: HelpArticleStatus.PUBLISHED, deletedAt: null },
      }),
      this.prisma.helpArticle.count({
        where: { status: HelpArticleStatus.DRAFT, deletedAt: null },
      }),
      this.prisma.helpArticle.count({
        where: { status: HelpArticleStatus.ARCHIVED, deletedAt: null },
      }),
      this.prisma.guidedWalkthrough.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.guidedWalkthrough.count({ where: { deletedAt: null } }),
      this.prisma.userManual.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.helpArticle.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.userManual.groupBy({
        by: ['moduleName'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.helpArticle.groupBy({
        by: ['category'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.guidedWalkthrough.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.helpArticle.aggregate({
        where: { deletedAt: null },
        _sum: { viewCount: true, helpfulCount: true, notHelpfulCount: true },
      }),
      this.prisma.userManual.count({
        where: {
          status: UserManualStatus.DRAFT,
          deletedAt: null,
          updatedAt: { lt: staleCutoff },
        },
      }),
      this.prisma.helpArticle.count({
        where: {
          status: HelpArticleStatus.DRAFT,
          deletedAt: null,
          updatedAt: { lt: staleCutoff },
        },
      }),
      this.prisma.userManual.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          manualCode: true,
          title: true,
          moduleName: true,
          roleName: true,
          manualType: true,
          status: true,
          version: true,
          updatedAt: true,
          publishedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
      this.prisma.helpArticle.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          articleCode: true,
          title: true,
          category: true,
          status: true,
          viewCount: true,
          helpfulCount: true,
          notHelpfulCount: true,
          updatedAt: true,
          publishedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
      this.prisma.helpArticle.findMany({
        where: { status: HelpArticleStatus.PUBLISHED, deletedAt: null },
        select: {
          id: true,
          articleCode: true,
          title: true,
          category: true,
          viewCount: true,
          helpfulCount: true,
          notHelpfulCount: true,
        },
        orderBy: { viewCount: 'desc' },
        take: 8,
      }),
    ]);

    const totalVotes =
      toNumber(articleEngagement._sum.helpfulCount) +
      toNumber(articleEngagement._sum.notHelpfulCount);

    return {
      totalManuals,
      publishedManuals,
      totalArticles,
      publishedArticles,
      manuals: {
        total: totalManuals,
        published: publishedManuals,
        reviewed: reviewedManuals,
        draft: draftManuals,
        publishRate: percentage(publishedManuals, totalManuals),
      },
      articles: {
        total: totalArticles,
        published: publishedArticles,
        draft: draftArticles,
        archived: archivedArticles,
        publishRate: percentage(publishedArticles, totalArticles),
        totalViews: toNumber(articleEngagement._sum.viewCount),
        helpfulnessRate: percentage(toNumber(articleEngagement._sum.helpfulCount), totalVotes),
      },
      walkthroughs: {
        total: totalWalkthroughs,
        active: activeWalkthroughs,
        activationRate: percentage(activeWalkthroughs, totalWalkthroughs),
      },
      staleContent: {
        manualDraftsOlderThan90Days: staleManualDrafts,
        articleDraftsOlderThan90Days: staleArticleDrafts,
      },
      manualStatusBreakdown: countBy(manualStatusRows as GroupCount[], 'status'),
      articleStatusBreakdown: countBy(articleStatusRows as GroupCount[], 'status'),
      manualsByModule: countBy(manualsByModuleRows as GroupCount[], 'moduleName', 'GENERAL'),
      articlesByCategory: countBy(articlesByCategoryRows as GroupCount[], 'category'),
      walkthroughStatusBreakdown: countBy(walkthroughStatusRows as GroupCount[], 'status'),
      recentManuals,
      recentArticles,
      popularArticles,
    };
  }
}

function daysBefore(date: Date, days: number) {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function countBy(rows: GroupCount[], key: string, emptyLabel = 'UNKNOWN') {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key];
    const label =
      value === null || value === undefined || value === '' ? emptyLabel : String(value);
    acc[label] = row._count._all;
    return acc;
  }, {});
}
