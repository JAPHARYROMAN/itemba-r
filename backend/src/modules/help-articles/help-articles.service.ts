import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class HelpArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: any, userId: string) {
    const record = await this.prisma.helpArticle.create({
      data: {
        articleCode: `HA-${Date.now()}`,
        title: dto.title,
        content: dto.content,
        category: dto.category,
        tags: dto.tags,
        status: 'DRAFT',
        createdById: userId,
        viewCount: 0,
        helpfulCount: 0,
        notHelpfulCount: 0,
      },
    });
    await this.auditLogs.log({ action: 'HELP_ARTICLE_CREATED', entityType: 'HelpArticle', entityId: record.id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async findAll(query: any, user: AuthUser) {
    const { page = 1, pageSize = 20, status, category } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };

    const canManage = user.permissions?.includes('help_articles.manage');
    if (!canManage) where.status = 'PUBLISHED';
    if (status && canManage) where.status = status;
    if (category) where.category = category;

    const [data, total] = await Promise.all([
      this.prisma.helpArticle.findMany({ where, skip, take: Number(pageSize), orderBy: { createdAt: 'desc' } }),
      this.prisma.helpArticle.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.helpArticle.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Help article not found');
    await this.prisma.helpArticle.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    await this.findOneNoIncrement(id);
    const record = await this.prisma.helpArticle.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
      },
    });
    await this.auditLogs.log({ action: 'HELP_ARTICLE_UPDATED', entityType: 'HelpArticle', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  private async findOneNoIncrement(id: string) {
    const record = await this.prisma.helpArticle.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Help article not found');
    return record;
  }

  async publish(id: string, userId: string) {
    await this.findOneNoIncrement(id);
    const record = await this.prisma.helpArticle.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedById: userId, publishedAt: new Date() },
    });
    await this.auditLogs.log({ action: 'HELP_ARTICLE_PUBLISHED', entityType: 'HelpArticle', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async setStatus(id: string, status: string, userId: string) {
    await this.findOneNoIncrement(id);
    const record = await this.prisma.helpArticle.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: `HELP_ARTICLE_${status}`, entityType: 'HelpArticle', entityId: id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async incrementCount(id: string, field: 'helpfulCount' | 'notHelpfulCount') {
    return this.prisma.helpArticle.update({
      where: { id },
      data: { [field]: { increment: 1 } },
    });
  }

  async remove(id: string, userId: string) {
    await this.findOneNoIncrement(id);
    await this.prisma.helpArticle.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'HELP_ARTICLE_DELETED', entityType: 'HelpArticle', entityId: id, userId, severity: AuditSeverity.MEDIUM });
    return { success: true };
  }
}
