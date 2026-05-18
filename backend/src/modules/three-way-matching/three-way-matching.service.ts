import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';

@Injectable()
export class ThreeWayMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { companyId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.threeWayMatch.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.threeWayMatch.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.threeWayMatch.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Three-way match not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertProcurementReferencesInCompany(dto);
    const item = await this.prisma.threeWayMatch.create({ data: { ...dto, matchedById: user.id } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'ThreeWayMatch', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async approve(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['MATCHED', 'PARTIAL_MATCH', 'VARIANCE'].includes(existing.matchStatus)) throw new BadRequestException('Cannot approve in current status');
    const updated = await this.prisma.threeWayMatch.update({ where: { id }, data: { approvedAt: new Date(), approvedById: user.id } });
    await this.auditLogs.log({ action: 'APPROVE', entityType: 'ThreeWayMatch', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }

  /**
   * Phase 2 — post the variance from a VARIANCE / PARTIAL_MATCH three-way
   * match as a price-variance adjustment journal entry.
   *
   * Reasoning: the SupplierInvoice approval already posted the full invoice
   * amount as DR Inventory / CR AP. When PO/GRN-vs-Invoice variance exists,
   * the cost was effectively recorded at the invoice price (which may differ
   * from the expected PO price). This adjustment moves the variance out of
   * Inventory into a Price Variance expense account so the cost basis of the
   * received stock stays aligned with the PO price.
   *
   * Idempotent: looks for an existing JE referencing this match by
   * (referenceType='ThreeWayMatch', referenceId=match.id) and short-circuits
   * if one is found.
   */
  async postVarianceAdjustment(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.MANAGE);
    if (existing.matchStatus !== 'VARIANCE' && existing.matchStatus !== 'PARTIAL_MATCH') {
      throw new BadRequestException(
        'Variance adjustment is only available for VARIANCE or PARTIAL_MATCH matches',
      );
    }
    if (!existing.approvedById) {
      throw new BadRequestException('Approve the three-way match before posting its variance');
    }

    const variance = new Prisma.Decimal(existing.amountVariance);
    if (variance.isZero()) {
      throw new BadRequestException('No amount variance to adjust');
    }

    // Idempotency: check whether a JE has already been posted for this match.
    const priorJe = await this.prisma.journalEntry.findFirst({
      where: {
        referenceType: 'ThreeWayMatch',
        referenceId: existing.id,
        deletedAt: null,
      },
      select: { id: true, journalNumber: true },
    });
    if (priorJe) {
      return {
        match: existing,
        journalEntry: priorJe,
        message: 'Variance adjustment already posted for this match',
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [varianceExpense, inventory] = await Promise.all([
        // Re-use GENERAL_EXPENSE for now; a dedicated PRICE_VARIANCE role
        // can be added when the chart of accounts adds an explicit code.
        this.accountResolver.resolve(existing.companyId, 'GENERAL_EXPENSE', tx),
        this.accountResolver.resolve(existing.companyId, 'INVENTORY', tx),
      ]);

      const absVariance = variance.abs();
      // Positive variance = invoice billed MORE than expected → DR Variance / CR Inventory.
      //   (The invoice already inflated Inventory; we move the over-charge out.)
      // Negative variance = invoice billed LESS than expected → DR Inventory / CR Variance.
      //   (Discount realized; book it back to inventory adjustment.)
      const lines = variance.gt(0)
        ? [
            { accountId: varianceExpense.id, debit: absVariance, description: `Price variance — match ${existing.matchNumber}` },
            { accountId: inventory.id, credit: absVariance, description: `Inventory variance write-down` },
          ]
        : [
            { accountId: inventory.id, debit: absVariance, description: `Inventory variance write-up` },
            { accountId: varianceExpense.id, credit: absVariance, description: `Negative price variance — match ${existing.matchNumber}` },
          ];

      const je = await this.postingEngine.postLines(
        {
          companyId: existing.companyId,
          transactionDate: existing.matchDate,
          description: `3WM variance adjustment ${existing.matchNumber}`,
          referenceType: 'ThreeWayMatch',
          referenceId: existing.id,
          moduleName: 'three-way-matching',
          userId: user.id,
          lines,
        },
        tx,
      );

      return { matchId: existing.id, journalEntry: je };
    });

    await this.auditLogs.log({
      action: 'POST_VARIANCE',
      entityType: 'ThreeWayMatch',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      newValue: { journalEntryId: result.journalEntry.id, amountVariance: variance.toString() } as any,
    });

    return result;
  }

  private async assertProcurementReferencesInCompany(dto: any) {
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
