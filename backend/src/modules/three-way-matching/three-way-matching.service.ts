import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma, ThreeWayMatchStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { pagination } from '../../common/utils/pagination';
import { paginatedResponse } from '../../common/utils/paginated-response';
import { CreateThreeWayMatchDto, QueryThreeWayMatchDto } from './dto/three-way-matching.dto';

@Injectable()
export class ThreeWayMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async findAll(query: QueryThreeWayMatchDto, user: AuthUser) {
    const { companyId, status, page = 1, limit = 20 } = query;
    const paging = pagination({ page, limit });
    const where: Prisma.ThreeWayMatchWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (status) where.matchStatus = status;
    const [items, total] = await Promise.all([
      this.prisma.threeWayMatch.findMany({
        where,
        skip: paging.skip,
        take: paging.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.threeWayMatch.count({ where }),
    ]);
    return paginatedResponse({ data: items, total, page: paging.page, limit: paging.limit });
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.threeWayMatch.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Three-way match not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: CreateThreeWayMatchDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertProcurementReferencesInCompany(dto);
    const item = await this.prisma.threeWayMatch.create({ data: { ...dto, matchedById: user.id } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'ThreeWayMatch', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async approve(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const approvableStatuses: ThreeWayMatchStatus[] = [
      ThreeWayMatchStatus.MATCHED,
      ThreeWayMatchStatus.PARTIAL_MATCH,
      ThreeWayMatchStatus.VARIANCE,
    ];
    if (!approvableStatuses.includes(existing.matchStatus)) {
      throw new BadRequestException('Cannot approve in current status');
    }
    if (existing.approvedAt) throw new BadRequestException('Three-way match is already approved');
    const updated = await this.prisma.$transaction(async (tx) => {
      const approved = await tx.threeWayMatch.update({ where: { id }, data: { approvedAt: new Date(), approvedById: user.id } });
      await this.postVarianceIfNeeded(existing, user.id, tx);
      return approved;
    });
    await this.auditLogs.log({ action: 'APPROVE', entityType: 'ThreeWayMatch', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }

  private async postVarianceIfNeeded(
    match: {
      id: string;
      matchNumber: string;
      companyId: string;
      purchaseOrderId: string;
      amountVariance: Prisma.Decimal | number | string | null;
      matchDate: Date;
    },
    userId: string,
    tx: Prisma.TransactionClient,
  ) {
    const amount = Number(match.amountVariance ?? 0);
    if (Math.abs(amount) < 0.01) return;

    const existingJournal = await tx.journalEntry.findFirst({
      where: {
        companyId: match.companyId,
        referenceType: 'ThreeWayMatchVariance',
        referenceId: match.id,
        status: 'POSTED',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingJournal) return;

    const purchaseOrder = await tx.purchaseOrder.findFirst({
      where: { id: match.purchaseOrderId, companyId: match.companyId, deletedAt: null },
      select: { divisionId: true, branchId: true },
    });
    const varianceAccount = await this.accountResolver.resolve(match.companyId, 'PURCHASE_VARIANCE', tx);
    const apAccount = await this.accountResolver.resolve(match.companyId, 'AP_CONTROL', tx);
    const absAmount = Math.abs(amount);
    const description = `Three-way match variance ${match.matchNumber}`;

    await this.postingEngine.postLines(
      {
        journalNumber: `JE-TWM-${match.matchNumber}`,
        companyId: match.companyId,
        divisionId: purchaseOrder?.divisionId,
        branchId: purchaseOrder?.branchId,
        transactionDate: match.matchDate,
        description,
        referenceType: 'ThreeWayMatchVariance',
        referenceId: match.id,
        moduleName: 'three-way-matching',
        userId,
        lines:
          amount > 0
            ? [
                { accountId: varianceAccount.id, description, debit: absAmount, credit: 0 },
                { accountId: apAccount.id, description, debit: 0, credit: absAmount },
              ]
            : [
                { accountId: apAccount.id, description, debit: absAmount, credit: 0 },
                { accountId: varianceAccount.id, description, debit: 0, credit: absAmount },
              ],
      },
      tx,
    );
  }

  private async assertProcurementReferencesInCompany(dto: CreateThreeWayMatchDto) {
    const checks: Array<Promise<{ companyId: string } | null>> = [];
    if (dto.purchaseOrderId) {
      checks.push(this.prisma.purchaseOrder.findFirst({
        where: { id: dto.purchaseOrderId, companyId: dto.companyId, deletedAt: null },
        select: { companyId: true },
      }));
    }
    if (dto.goodsReceivedNoteId) {
      checks.push(this.prisma.goodsReceivedNote.findFirst({
        where: { id: dto.goodsReceivedNoteId, companyId: dto.companyId, deletedAt: null },
        select: { companyId: true },
      }));
    }
    if (dto.supplierInvoiceId) {
      checks.push(this.prisma.supplierInvoice.findFirst({
        where: { id: dto.supplierInvoiceId, companyId: dto.companyId, deletedAt: null },
        select: { companyId: true },
      }));
    }

    const results = await Promise.all(checks);
    if (results.some((row) => !row)) {
      throw new BadRequestException('Procurement references must belong to the selected company');
    }
  }
}
