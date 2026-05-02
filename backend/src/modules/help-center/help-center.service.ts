import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class HelpCenterService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: any, user: AuthUser) {
    const { keyword } = query;
    const canManage = user.permissions?.includes('documentation.manage');
    const statusFilter = canManage ? {} : { status: 'PUBLISHED' as const };

    const [manuals, articles] = await Promise.all([
      this.prisma.userManual.findMany({
        where: {
          deletedAt: null,
          ...statusFilter,
          OR: [
            { title: { contains: keyword, mode: 'insensitive' } },
            { content: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        take: 20,
      }),
      this.prisma.helpArticle.findMany({
        where: {
          deletedAt: null,
          ...statusFilter,
          OR: [
            { title: { contains: keyword, mode: 'insensitive' } },
            { content: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        take: 20,
      }),
    ]);
    return { manuals, articles };
  }

  async getOverview(user: AuthUser) {
    const canManage = user.permissions?.includes('documentation.manage');
    const statusFilter = canManage ? {} : { status: 'PUBLISHED' as const };

    const [popularArticles, recentArticles, categories] = await Promise.all([
      this.prisma.helpArticle.findMany({
        where: { deletedAt: null, ...statusFilter },
        orderBy: { viewCount: 'desc' },
        take: 5,
      }),
      this.prisma.helpArticle.findMany({
        where: { deletedAt: null, ...statusFilter },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.helpArticle.groupBy({
        by: ['category'],
        where: { deletedAt: null, ...statusFilter },
        _count: { id: true },
      }),
    ]);
    return { popularArticles, recentArticles, categories };
  }
}
