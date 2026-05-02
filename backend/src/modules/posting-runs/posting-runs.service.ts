import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class PostingRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.postingRun.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.postingRun.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.postingRun.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Posting run not found');
    return item;
  }

  async create(dto: any, user: any) {
    const item = await this.prisma.postingRun.create({ data: { ...dto, status: 'DRAFT', createdById: user.id } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'PostingRun', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async postRun(id: string, user: any) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT runs can be posted');
    const updated = await this.prisma.postingRun.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), postedById: user.id } });
    await this.auditLogs.log({ action: 'POST', entityType: 'PostingRun', entityId: id, userId: user.id });
    return updated;
  }

  async reverseRun(id: string, user: any) {
    const existing = await this.findOne(id);
    if (existing.status !== 'POSTED') throw new BadRequestException('Only POSTED runs can be reversed');
    const updated = await this.prisma.postingRun.update({ where: { id }, data: { status: 'REVERSED', reversedAt: new Date(), reversedById: user.id } });
    await this.auditLogs.log({ action: 'REVERSE', entityType: 'PostingRun', entityId: id, userId: user.id });
    return updated;
  }
}
