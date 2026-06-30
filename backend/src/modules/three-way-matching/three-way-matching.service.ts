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
import { computeThreeWayMatch, ComputedThreeWayMatch } from './three-way-match-calculator';

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
    if (!dto.supplierInvoiceId) {
      throw new BadRequestException('A supplier invoice is required for three-way matching');
    }

    // Variances and match status are computed server-side from the live PO / GRN /
    // invoice — never taken from the client (the form fields are advisory only).
    const computed = await this.computeMatch(
      {
        companyId: dto.companyId,
        purchaseOrderId: dto.purchaseOrderId,
        goodsReceivedNoteId: dto.goodsReceivedNoteId,
        supplierInvoiceId: dto.supplierInvoiceId,
      },
      this.prisma,
    );

    const item = await this.prisma.threeWayMatch.create({
      data: {
        matchNumber: dto.matchNumber,
        companyId: dto.companyId,
        purchaseOrderId: dto.purchaseOrderId,
        goodsReceivedNoteId: dto.goodsReceivedNoteId,
        supplierInvoiceId: dto.supplierInvoiceId,
        matchDate: dto.matchDate ? new Date(dto.matchDate) : undefined,
        notes: dto.notes,
        quantityVariance: computed.quantityVariance,
        amountVariance: computed.amountVariance,
        matchStatus: computed.matchStatus,
        matchedById: user.id,
      },
    });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'ThreeWayMatch', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  /**
   * Load the live PO (+GRN, +invoice) and compute the three-way variance with the
   * shared Decimal-precise calculator. The company-scoped `findFirst` clauses also
   * assert the references belong to the match's company.
   */
  private async computeMatch(
    refs: {
      companyId: string;
      purchaseOrderId: string;
      goodsReceivedNoteId?: string | null;
      supplierInvoiceId?: string | null;
    },
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<ComputedThreeWayMatch> {
    const purchaseOrder = await db.purchaseOrder.findFirst({
      where: { id: refs.purchaseOrderId, companyId: refs.companyId, deletedAt: null },
      include: { lines: true },
    });
    if (!purchaseOrder) throw new BadRequestException('Purchase order not found for this company');

    if (!refs.supplierInvoiceId) {
      throw new BadRequestException('A supplier invoice is required for three-way matching');
    }
    const invoice = await db.supplierInvoice.findFirst({
      where: { id: refs.supplierInvoiceId, companyId: refs.companyId, deletedAt: null },
      include: { lines: true },
    });
    if (!invoice) throw new BadRequestException('Supplier invoice not found for this company');

    const grn = refs.goodsReceivedNoteId
      ? await db.goodsReceivedNote.findFirst({
          where: { id: refs.goodsReceivedNoteId, companyId: refs.companyId, deletedAt: null },
          include: { lines: true },
        })
      : null;
    if (refs.goodsReceivedNoteId && !grn) {
      throw new BadRequestException('GRN not found for this company');
    }

    return computeThreeWayMatch({
      invoice,
      purchaseOrderLines: purchaseOrder.lines,
      grnLines: grn?.lines ?? null,
    });
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
      // Recompute the variance from the live references and post the JE against
      // the freshly-computed amount — never a stored / operator-supplied value.
      if (existing.supplierInvoiceId) {
        const computed = await this.computeMatch(
          {
            companyId: existing.companyId,
            purchaseOrderId: existing.purchaseOrderId,
            goodsReceivedNoteId: existing.goodsReceivedNoteId,
            supplierInvoiceId: existing.supplierInvoiceId,
          },
          tx,
        );
        await this.postVarianceIfNeeded(
          { ...existing, amountVariance: computed.amountVariance },
          user.id,
          tx,
        );
      }
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

}
