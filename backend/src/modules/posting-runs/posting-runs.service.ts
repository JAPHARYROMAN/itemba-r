import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, PostingRunStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { pagination } from '../../common/utils/pagination';
import { paginatedResponse } from '../../common/utils/paginated-response';
import { CreatePostingRunDto, QueryPostingRunDto } from './dto/posting-run.dto';

@Injectable()
export class PostingRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryPostingRunDto, user: AuthUser) {
    const { companyId, status, page = 1, limit = 20 } = query;
    const paging = pagination({ page, limit });
    const where: Prisma.PostingRunWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.postingRun.findMany({
        where,
        skip: paging.skip,
        take: paging.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.postingRun.count({ where }),
    ]);
    return paginatedResponse({ data: items, total, page: paging.page, limit: paging.limit });
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.postingRun.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Posting run not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: CreatePostingRunDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const item = await this.prisma.postingRun.create({
      data: { ...dto, status: PostingRunStatus.DRAFT },
    });
    await this.auditLogs.log({
      action: 'CREATE',
      entityType: 'PostingRun',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
    });
    return item;
  }

  async postRun(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== PostingRunStatus.DRAFT) throw new BadRequestException('Only DRAFT runs can be posted');
    // Atomic guarded transition: only flip DRAFT -> POSTED if the row is still
    // DRAFT, so two concurrent posts cannot both succeed (check-then-update race).
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.postingRun.updateMany({
        where: { id, status: PostingRunStatus.DRAFT, deletedAt: null },
        data: { status: PostingRunStatus.POSTED, postedAt: new Date(), postedById: user.id },
      });
      if (result.count === 0) throw new BadRequestException('Only DRAFT runs can be posted');
      return tx.postingRun.findUniqueOrThrow({ where: { id } });
    });
    await this.auditLogs.log({
      action: 'POST',
      entityType: 'PostingRun',
      entityId: id,
      userId: user.id,
    });
    return updated;
  }

  async reverseRun(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== PostingRunStatus.POSTED)
      throw new BadRequestException('Only POSTED runs can be reversed');
    // Atomic guarded transition: only flip POSTED -> REVERSED if the row is still
    // POSTED, so a run cannot be reversed twice via a check-then-update race.
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.postingRun.updateMany({
        where: { id, status: PostingRunStatus.POSTED, deletedAt: null },
        data: { status: PostingRunStatus.REVERSED, reversedAt: new Date(), reversedById: user.id },
      });
      if (result.count === 0) throw new BadRequestException('Only POSTED runs can be reversed');
      return tx.postingRun.findUniqueOrThrow({ where: { id } });
    });
    await this.auditLogs.log({
      action: 'REVERSE',
      entityType: 'PostingRun',
      entityId: id,
      userId: user.id,
    });
    return updated;
  }
}
