import { assertLegacyPosWriteAllowed } from '../../common/services/pos-draft-policy';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AccessLevel, AuditSeverity, Prisma, StockAdjustmentStatus } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AccountResolverService,
  CompanyScopeService,
  OrganizationScopeService,
} from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { PostingEngineService, PostingLine } from '../accounting-engine/posting-engine.service';
import {
  CreateStockAdjustmentDto,
  StockAdjustmentLineDto,
} from './dto/create-stock-adjustment.dto';
import { QueryStockAdjustmentDto } from './dto/query-stock-adjustment.dto';
import { RejectStockAdjustmentDto } from './dto/reject-stock-adjustment.dto';
import { UpdateStockAdjustmentDto } from './dto/update-stock-adjustment.dto';
import { SubmitStockAdjustmentDto } from './dto/submit-stock-adjustment.dto';
import { lockInventoryProducts } from '../inventory-movements/inventory-product-lock';

type StockAdjustmentReferenceIds = {
  divisionId?: string | null;
  branchId?: string | null;
  lines?: StockAdjustmentLineDto[];
};

function generateAdjustmentNumber(): string {
  return `SA-${new Date().getFullYear()}-${randomUUID().slice(0, 12).toUpperCase()}`;
}

function normalizeAdjustmentLine(line: StockAdjustmentLineDto) {
  const suppliedSystem = line.systemQuantity ?? line.systemQty;
  const systemQuantity = suppliedSystem == null ? undefined : Number(suppliedSystem);
  const countedQuantity = Number(line.countedQuantity ?? line.countedQty);
  if (
    (systemQuantity !== undefined && !Number.isFinite(systemQuantity)) ||
    !Number.isFinite(countedQuantity)
  ) {
    throw new BadRequestException('Stock adjustment quantities must be valid numbers');
  }
  if (
    countedQuantity < 0 ||
    [systemQuantity, countedQuantity].some(
      (value) =>
        value !== undefined &&
        (new Prisma.Decimal(value).decimalPlaces() > 4 || Math.abs(value) >= 1e14),
    )
  ) {
    throw new BadRequestException(
      'Counts must be nonnegative and quantities must fit four decimal places',
    );
  }
  if (
    (line.systemQuantity != null &&
      line.systemQty != null &&
      line.systemQuantity !== line.systemQty) ||
    (line.countedQuantity != null &&
      line.countedQty != null &&
      line.countedQuantity !== line.countedQty)
  ) {
    throw new BadRequestException('Conflicting stock adjustment quantity aliases');
  }
  if (
    line.expectedRevision !== undefined &&
    (!Number.isSafeInteger(line.expectedRevision) || line.expectedRevision < 0)
  ) {
    throw new BadRequestException('Expected stock revision must be a nonnegative integer');
  }
  const unitCost =
    line.unitCost === undefined || line.unitCost === null ? undefined : Number(line.unitCost);
  if (
    unitCost !== undefined &&
    (!Number.isFinite(unitCost) ||
      unitCost <= 0 ||
      unitCost >= 1e14 ||
      new Prisma.Decimal(unitCost).decimalPlaces() > 4)
  ) {
    throw new BadRequestException('Stock adjustment unit cost must be greater than zero');
  }
  return {
    ...line,
    systemQuantity,
    countedQuantity,
    unitCost,
  };
}

@Injectable()
export class StockAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly companyScope: CompanyScopeService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
    private readonly organizationScope: OrganizationScopeService,
  ) {}

  async findAll(query: QueryStockAdjustmentDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      status,
      locationId,
      dateFrom,
      dateTo,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const companyWhere = (await this.companyScope.companyWhereFor(
      user,
      companyId,
    )) as Prisma.StockAdjustmentWhereInput;
    const organizationScope = await this.organizationScope.recordWhereFor(user);
    const organizationWhere: Prisma.StockAdjustmentWhereInput =
      'OR' in organizationScope && Array.isArray(organizationScope.OR)
        ? {
            OR: organizationScope.OR.flatMap<Prisma.StockAdjustmentWhereInput>((filter) =>
              'divisionId' in filter
                ? [filter, { divisionId: null, branch: { divisionId: filter.divisionId } }]
                : [filter],
            ),
          }
        : organizationScope;
    const where: Prisma.StockAdjustmentWhereInput = {
      deletedAt: null,
      AND: [companyWhere, organizationWhere],
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (locationId) where.branchId = locationId;
    if (search?.trim()) {
      const contains = { contains: search.trim(), mode: 'insensitive' as const };
      where.AND = [
        ...(where.AND as Prisma.StockAdjustmentWhereInput[]),
        {
          OR: [
            { adjustmentNumber: contains },
            { reason: contains },
            { notes: contains },
            { company: { name: contains } },
            { branch: { name: contains } },
          ],
        },
      ];
    }
    if (dateFrom || dateTo) {
      if (
        (dateFrom && !Number.isFinite(Date.parse(dateFrom))) ||
        (dateTo && !Number.isFinite(Date.parse(dateTo))) ||
        (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo))
      ) {
        throw new BadRequestException('Choose a valid date range.');
      }
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(
    id: string,
    user?: AuthUser,
    minimum: AccessLevel = AccessLevel.READ,
    transaction?: Prisma.TransactionClient,
  ) {
    const record = await (transaction ?? this.prisma).stockAdjustment.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true, divisionId: true } },
        division: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
        postedBy: { select: { id: true, fullName: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            unit: { select: { id: true, name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Stock adjustment not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
      await this.organizationScope.assertCanAccessScope(
        user,
        record.divisionId ?? record.branch?.divisionId,
        record.branchId,
        minimum,
      );
    }
    return record;
  }

  async create(dto: CreateStockAdjustmentDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    this.validateLines(dto.lines);
    if (
      dto.idempotencyKey !== undefined &&
      (!dto.idempotencyKey.trim() || dto.idempotencyKey.length > 120)
    ) {
      throw new BadRequestException('Choose a nonempty retry key of at most 120 characters');
    }
    const requestFingerprint = this.requestFingerprint(dto);
    return this.prisma.$transaction(
      async (tx) => {
        if (dto.idempotencyKey) {
          // Serialize one company/key without changing the schema. Check replay
          // before today's quantity, revision, or product-definition validation.
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${dto.companyId}:stock-count:${dto.idempotencyKey}`}, 0))`,
          );
          const replay = await tx.stockAdjustment.findFirst({
            where: { companyId: dto.companyId, idempotencyKey: dto.idempotencyKey, deletedAt: {} },
            include: { lines: true },
          });
          if (replay) {
            await this.organizationScope.assertCanAccessScope(
              user,
              replay.divisionId,
              replay.branchId,
              AccessLevel.WRITE,
            );
            if (replay.deletedAt)
              throw new ConflictException({
                code: 'STOCK_COUNT_CHANGED',
                adjustmentId: replay.id,
                message:
                  'This retry key belongs to a deleted adjustment. Start a new count with a new key.',
              });
            const audit = await tx.auditLog.findFirst({
              where: {
                companyId: dto.companyId,
                entityType: 'StockAdjustment',
                entityId: replay.id,
                action: 'STOCK_ADJUSTMENT_CREATE',
              },
              orderBy: { createdAt: 'asc' },
              select: { userId: true, metadata: true },
            });
            const metadata = audit?.metadata as Record<string, unknown> | null;
            if (
              audit?.userId !== user.id ||
              JSON.stringify(metadata?.requestFingerprintSha256) !==
                JSON.stringify(requestFingerprint) ||
              JSON.stringify(metadata?.capturedFingerprintSha256) !==
                JSON.stringify(this.capturedFingerprint(replay))
            ) {
              throw new ConflictException({
                code: 'STOCK_COUNT_CHANGED',
                adjustmentId: replay.id,
                message:
                  'This retry key belongs to a different stock count. Reload the saved adjustment.',
              });
            }
            return replay;
          }
        }
        await lockInventoryProducts(
          tx,
          dto.lines.map((line) => line.productId),
        );
        const scope = await this.assertReferencesBelongToCompany(dto.companyId, dto, tx);
        await this.organizationScope.assertCanAccessScope(
          user,
          scope.divisionId,
          dto.branchId,
          AccessLevel.WRITE,
        );
        const lines = await this.captureLines(tx, dto.companyId, dto.branchId, dto.lines);
        const record = await tx.stockAdjustment.create({
          data: {
            adjustmentNumber: generateAdjustmentNumber(),
            companyId: dto.companyId,
            divisionId: scope.divisionId,
            branchId: dto.branchId,
            reason: dto.reason,
            notes: dto.notes,
            status: 'DRAFT',
            createdById: user.id,
            idempotencyKey: dto.idempotencyKey,
            lines: {
              create: lines,
            },
          },
          include: { lines: true },
        });

        await this.auditLogs.logStrictInTransaction(tx, {
          action: 'STOCK_ADJUSTMENT_CREATE',
          entityType: 'StockAdjustment',
          entityId: record.id,
          userId: user.id,
          companyId: record.companyId,
          newValue: record as any,
          metadata: {
            requestFingerprintSha256: requestFingerprint,
            capturedFingerprintSha256: this.capturedFingerprint(record),
          },
        });

        return record;
      },
      { timeout: 60_000 },
    );
  }

  async update(id: string, dto: UpdateStockAdjustmentDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Stock adjustment can only be edited in DRAFT status');
    }
    if (dto.branchId && dto.branchId !== existing.branchId && !dto.lines) {
      throw new BadRequestException('Changing the location requires recapturing all count lines');
    }
    if (dto.lines) this.validateLines(dto.lines);
    return this.prisma.$transaction(
      async (tx) => {
        await lockInventoryProducts(tx, [
          ...existing.lines.map((line) => line.productId),
          ...(dto.lines ?? []).map((line) => line.productId),
        ]);
        const scope = await this.assertReferencesBelongToCompany(
          existing.companyId,
          {
            divisionId: existing.divisionId,
            branchId: dto.branchId ?? existing.branchId,
            lines: dto.lines,
          },
          tx,
        );
        await this.organizationScope.assertCanAccessScope(
          user,
          scope.divisionId,
          dto.branchId ?? existing.branchId,
          AccessLevel.WRITE,
        );
        const lines = dto.lines
          ? await this.captureLines(
              tx,
              existing.companyId,
              (dto.branchId ?? existing.branchId)!,
              dto.lines,
            )
          : undefined;
        const claimed = await tx.stockAdjustment.updateMany({
          where: { id, deletedAt: null, status: 'DRAFT', updatedAt: existing.updatedAt },
          data: { updatedAt: new Date() },
        });
        if (claimed.count !== 1)
          throw new ConflictException('The adjustment changed. Reload it before editing.');
        const record = await tx.stockAdjustment.update({
          where: { id },
          data: {
            ...(dto.reason !== undefined && { reason: dto.reason }),
            ...(dto.notes !== undefined && { notes: dto.notes }),
            ...(dto.branchId !== undefined && { branchId: dto.branchId }),
            ...(dto.lines && {
              lines: {
                deleteMany: {},
                create: lines,
              },
            }),
          },
          include: { lines: true },
        });

        await this.auditLogs.logStrictInTransaction(tx, {
          action: 'STOCK_ADJUSTMENT_UPDATE',
          entityType: 'StockAdjustment',
          entityId: id,
          userId,
          companyId: record.companyId,
          oldValue: existing as any,
          newValue: record as any,
        });

        return record;
      },
      { timeout: 60_000 },
    );
  }

  async submit(id: string, user: AuthUser, dto: SubmitStockAdjustmentDto = {}) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.findOne(id, user, AccessLevel.WRITE, tx);
      if (existing.status !== 'DRAFT') {
        throw new ConflictException(
          'Only DRAFT adjustments can be submitted. Reload the adjustment.',
        );
      }
      if (
        dto.expectedUpdatedAt &&
        (!Number.isFinite(Date.parse(dto.expectedUpdatedAt)) ||
          new Date(dto.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime())
      ) {
        throw new ConflictException('The adjustment changed. Reload it before submitting.');
      }
      if (!existing.lines.length)
        throw new BadRequestException('Add at least one count line before submitting');
      const claimed = await tx.stockAdjustment.updateMany({
        where: { id, deletedAt: null, status: 'DRAFT', updatedAt: existing.updatedAt },
        data: { status: 'PENDING_APPROVAL' },
      });
      if (claimed.count !== 1)
        throw new ConflictException('The adjustment changed. Reload it before submitting.');
      const record = await tx.stockAdjustment.findUniqueOrThrow({ where: { id } });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'STOCK_ADJUSTMENT_SUBMIT',
        entityType: 'StockAdjustment',
        entityId: id,
        userId: user.id,
        companyId: record.companyId,
        oldValue: { status: 'DRAFT' } as any,
        newValue: { status: 'PENDING_APPROVAL' } as any,
      });

      return record;
    });
  }

  async approve(id: string, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const userId = user.id;
      const existing = await this.findOne(id, user, AccessLevel.WRITE, tx);
      if (existing.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException('Only PENDING_APPROVAL adjustments can be approved');
      }

      const record = await this.claimUnposted(tx, existing, {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
      });

      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'STOCK_ADJUSTMENT_APPROVE',
        entityType: 'StockAdjustment',
        entityId: id,
        userId,
        companyId: record.companyId,
        oldValue: { status: 'PENDING_APPROVAL' } as any,
        newValue: { status: 'APPROVED' } as any,
      });

      return record;
    });
  }

  async reject(id: string, dto: RejectStockAdjustmentDto, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const userId = user.id;
      const existing = await this.findOne(id, user, AccessLevel.WRITE, tx);
      if (existing.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException('Only PENDING_APPROVAL adjustments can be rejected');
      }

      const reason = dto.reason?.trim();
      if (!reason) {
        throw new BadRequestException('Rejection reason is required');
      }

      const record = await this.claimUnposted(tx, existing, {
        status: 'REJECTED',
        // Preserve any existing notes; surface the rejection reason on the record
        // (the schema has no dedicated rejectionReason column).
        notes: existing.notes ? `${existing.notes}\n[Rejected] ${reason}` : `[Rejected] ${reason}`,
      });

      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'STOCK_ADJUSTMENT_REJECT',
        entityType: 'StockAdjustment',
        entityId: id,
        userId,
        companyId: record.companyId,
        oldValue: { status: 'PENDING_APPROVAL' } as any,
        newValue: { status: 'REJECTED', rejectionReason: reason } as any,
      });

      return record;
    });
  }

  async revertApproval(id: string, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const userId = user.id;
      const existing = await this.findOne(id, user, AccessLevel.WRITE, tx);
      if (existing.status !== 'APPROVED') {
        throw new BadRequestException('Only APPROVED adjustments can be reverted to draft');
      }
      if (existing.postedAt) {
        throw new BadRequestException('Posted adjustments cannot be reverted to draft');
      }

      const movementCount = await tx.inventoryMovement.count({
        where: {
          referenceType: 'StockAdjustment',
          referenceId: id,
        },
      });
      if (movementCount > 0) {
        throw new BadRequestException(
          'This adjustment already has inventory movements and cannot be reverted to draft',
        );
      }

      const record = await this.claimUnposted(tx, existing, {
        status: 'DRAFT',
        approvedById: null,
        approvedAt: null,
      });

      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'STOCK_ADJUSTMENT_REVERT_APPROVAL',
        entityType: 'StockAdjustment',
        entityId: id,
        userId,
        companyId: record.companyId,
        oldValue: { status: 'APPROVED', approvedById: existing.approvedById } as any,
        newValue: { status: 'DRAFT' } as any,
        severity: AuditSeverity.HIGH,
      });

      return record;
    });
  }

  async post(id: string, user: AuthUser, transaction?: Prisma.TransactionClient) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE, transaction);
    if (!transaction)
      await assertLegacyPosWriteAllowed(this.prisma, user, existing.companyId, existing.branchId);
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED adjustments can be posted');
    }
    if (!existing.branchId) {
      throw new BadRequestException('Branch/location is required to post stock adjustment');
    }
    // Narrow to a non-null `string` const the transaction closure can carry:
    // TypeScript does not propagate the `existing.branchId` guard into the async
    // closure below (the captured object could, in principle, be reassigned), so
    // bind the checked value here where the narrowing is guaranteed.
    const branchId: string = existing.branchId;

    // ITMB-042: Apply all inventory movements and flip the status in ONE transaction so a
    // mid-loop failure rolls back every balance change, and atomically claim the document
    // (guarded on status === APPROVED) up front so concurrent/retried posts cannot
    // double-apply the variances.
    //
    // The explicit timeout is load-bearing, not decoration. Every non-zero
    // variance line costs roughly ten round-trips in here (two balance value
    // reads, createMovement's scope/reference/cost checks, a code-sequence hit,
    // the movement insert, the balance upsert and its FOR UPDATE re-read), and
    // a physical stock count — desktop or from the Mobile POS Lite Hesabu
    // screen — is hundreds of lines. Prisma's 5s interactive-transaction
    // default would abort those with P2028 partway through: correct (it rolls
    // back), but it makes a real closing count impossible to post and leaves
    // the adjustment sitting at APPROVED for a human to puzzle over. 60s
    // matches the ceiling the payroll posting transactions use.
    const run = async (tx: Prisma.TransactionClient) => {
      await lockInventoryProducts(
        tx,
        existing.lines.map((line) => line.productId),
      );
      const currentProducts = existing.lines.length
        ? await tx.product.findMany({
            where: {
              id: { in: existing.lines.map((line) => line.productId) },
              companyId: existing.companyId,
              deletedAt: null,
            },
            select: { id: true, baseUnitId: true, trackInventory: true, productType: true },
          })
        : [];
      for (const line of existing.lines) {
        const product = currentProducts.find((item) => item.id === line.productId);
        if (
          !product ||
          !product.trackInventory ||
          product.baseUnitId !== line.unitId ||
          ['SERVICE', 'NON_STOCK_ITEM'].includes(product.productType)
        ) {
          throw new BadRequestException(
            'A product stock definition changed. Review the saved count before posting.',
          );
        }
      }
      const claimed = await tx.stockAdjustment.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'POSTED', postedById: userId, postedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Only APPROVED adjustments can be posted');
      }

      // Inbound adjustments (count-ups) create a stock movement that must carry a
      // unit cost > 0 for stock products (assertInventoryMovementHasCost). Adjustment
      // lines hold no cost of their own (physical counts), so value the added units
      // at the product's current weighted-average cost when it already holds valued
      // stock, otherwise at the product (then family) default purchase cost.
      const inboundProductIds = [
        ...new Set(
          existing.lines
            .filter((line) => Number(line.varianceQuantity) > 0)
            .map((line) => line.productId),
        ),
      ];
      const costProducts = inboundProductIds.length
        ? await tx.product.findMany({
            where: {
              id: { in: inboundProductIds },
              companyId: existing.companyId,
              deletedAt: null,
            },
            select: {
              id: true,
              name: true,
              defaultPurchasePrice: true,
              productFamily: { select: { defaultPurchasePrice: true } },
            },
          })
        : [];
      const costProductById = new Map(costProducts.map((product) => [product.id, product]));
      const balanceRows = inboundProductIds.length
        ? await tx.inventoryBalance.findMany({
            where: {
              companyId: existing.companyId,
              branchId: existing.branchId,
              productId: { in: inboundProductIds },
            },
            select: { productId: true, averageCost: true, quantityOnHand: true },
          })
        : [];
      const avgCostByProduct = new Map(
        balanceRows.map((row) => [row.productId, Number(row.averageCost)]),
      );
      const quantityByProduct = new Map(
        balanceRows.map((row) => [row.productId, new Prisma.Decimal(row.quantityOnHand)]),
      );

      // ITMB (GL audit fix): a stock adjustment relieves/adds inventory subledger
      // VALUE via applyMovementToBalance but must post the matching GL swing in
      // the SAME transaction so the GL Inventory Asset stays reconciled to the
      // subledger and the shrinkage loss / count-up gain hits P&L. We measure the
      // EXACT value change by reading inventoryBalance.totalValue immediately
      // before and after each movement (the movement math floors relieved value
      // at zero and forces value to zero when qty hits zero, so qty*avgCost is not
      // always the true delta). The net of those deltas becomes the Inventory
      // Asset GL leg; the offset goes to the inventory-adjustment variance
      // account (Dr on a net loss / count-down, Cr on a net gain / count-up).
      const postingBranchId = branchId; // asserted non-null before the tx
      let inventoryValueDelta = new Prisma.Decimal(0); // >0 = inventory grew

      for (const line of existing.lines) {
        const variance = Number(line.varianceQuantity);
        if (variance === 0) continue;

        const movementType = variance > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
        // Outbound adjustments relieve value at the existing average cost, so the
        // caller supplies no cost; inbound adjustments resolve one (WAC -> default).
        let unitCost: number | undefined;
        const zeroEndingCorrection =
          variance > 0 &&
          Number(line.countedQuantity) === 0 &&
          Number(line.systemQuantity) < 0 &&
          quantityByProduct.get(line.productId)?.plus(variance).eq(0);
        if (variance > 0 && !zeroEndingCorrection) {
          const lineUnitCost = line.unitCost != null ? Number(line.unitCost) : 0;
          if (lineUnitCost > 0) {
            unitCost = lineUnitCost;
          } else {
            const wac = avgCostByProduct.get(line.productId) ?? 0;
            if (wac > 0) {
              unitCost = wac;
            } else {
              const product = costProductById.get(line.productId);
              unitCost =
                product?.defaultPurchasePrice != null
                  ? Number(product.defaultPurchasePrice)
                  : product?.productFamily?.defaultPurchasePrice != null
                    ? Number(product.productFamily.defaultPurchasePrice)
                    : undefined;
              if (!unitCost || unitCost <= 0) {
                throw new BadRequestException(
                  `Stock add for ${product?.name ?? line.productId} must include a unit cost greater than zero`,
                );
              }
            }
          }
        }

        const beforeValue = await this.readBalanceValue(
          tx,
          existing.companyId,
          line.productId,
          postingBranchId,
        );

        await this.inventoryMovements.createMovement({
          companyId: existing.companyId,
          productId: line.productId,
          movementType: movementType as any,
          quantity: Math.abs(variance),
          unitId: line.unitId,
          unitCost,
          movementDate: new Date(),
          createdById: existing.createdById ?? userId,
          auditActorUserId: userId,
          referenceType: 'StockAdjustment',
          referenceId: existing.id,
          divisionId: existing.divisionId ?? undefined,
          branchId: existing.branchId ?? undefined,
          tx,
        });

        const afterValue = await this.readBalanceValue(
          tx,
          existing.companyId,
          line.productId,
          postingBranchId,
        );
        inventoryValueDelta = inventoryValueDelta.plus(afterValue.minus(beforeValue));
      }

      // Only touch the GL when a real value swing occurred. Zero-value moves
      // (e.g. a cost-less count-up onto empty stock, or an outbound floored to
      // zero) leave inventory value unchanged and need no journal entry.
      const netDelta = inventoryValueDelta.toDecimalPlaces(2);
      if (!netDelta.isZero()) {
        await this.postAdjustmentLedger(tx, {
          companyId: existing.companyId,
          divisionId: existing.divisionId ?? null,
          branchId: postingBranchId,
          adjustmentId: existing.id,
          adjustmentNumber: existing.adjustmentNumber,
          transactionDate: new Date(),
          inventoryValueDelta: netDelta,
          userId,
        });
      }

      const posted = await tx.stockAdjustment.update({
        where: { id },
        data: { status: 'POSTED', postedById: userId, postedAt: new Date() },
      });

      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'STOCK_ADJUSTMENT_POST',
        entityType: 'StockAdjustment',
        entityId: id,
        userId,
        companyId: posted.companyId,
        oldValue: { status: 'APPROVED' } as any,
        newValue: { status: 'POSTED' } as any,
        severity: AuditSeverity.HIGH,
      });
      return posted;
    };
    const record = transaction
      ? await run(transaction)
      : await this.prisma.$transaction(run, { timeout: 60_000 });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const userId = user.id;
      const existing = await this.findOne(id, user, AccessLevel.WRITE, tx);
      if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
        throw new BadRequestException('Only DRAFT or REJECTED adjustments can be deleted');
      }

      await this.claimUnposted(tx, existing, { deletedAt: new Date() });

      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'STOCK_ADJUSTMENT_DELETE',
        entityType: 'StockAdjustment',
        entityId: id,
        userId,
        companyId: existing.companyId,
        oldValue: existing as any,
      });

      return { success: true };
    });
  }

  /** Stale approvals/rejections/reverts/deletes may never overwrite a post. */
  private async claimUnposted(
    tx: Prisma.TransactionClient,
    existing: { id: string; status: StockAdjustmentStatus; updatedAt: Date; postedAt: Date | null },
    data: Prisma.StockAdjustmentUncheckedUpdateManyInput,
  ) {
    if (existing.postedAt)
      throw new ConflictException(
        'The adjustment was posted. Reload it before changing its state.',
      );
    const claimed = await tx.stockAdjustment.updateMany({
      where: {
        id: existing.id,
        status: existing.status,
        updatedAt: existing.updatedAt,
        postedAt: null,
        deletedAt: null,
      },
      data,
    });
    if (claimed.count !== 1)
      throw new ConflictException('The adjustment changed. Reload it before changing its state.');
    return tx.stockAdjustment.findUniqueOrThrow({ where: { id: existing.id } });
  }

  /**
   * Read the current inventory subledger VALUE (totalValue) for a
   * company/product/branch line, returning 0 when no balance row exists yet.
   * Used to measure the exact GL swing produced by a movement (see post()).
   */
  private async readBalanceValue(
    tx: Prisma.TransactionClient,
    companyId: string,
    productId: string,
    branchId: string,
  ): Promise<Prisma.Decimal> {
    const rows = await tx.$queryRaw<Array<{ totalValue: Prisma.Decimal }>>(Prisma.sql`
      SELECT "totalValue" FROM inventory_balances
      WHERE "companyId" = ${companyId} AND "productId" = ${productId} AND "branchId" = ${branchId}
      FOR UPDATE
    `);
    const row = rows[0];
    return row ? new Prisma.Decimal(row.totalValue) : new Prisma.Decimal(0);
  }

  /**
   * Post the balanced GL entry for a posted stock adjustment so the GL Inventory
   * Asset account moves in lock-step with the inventory subledger, and the
   * shrinkage loss / count-up gain is recognised in P&L.
   *
   * `inventoryValueDelta` is the net change in inventory subledger value across
   * every line of the adjustment (positive = inventory grew on a net count-up,
   * negative = inventory shrank on a net loss/count-down):
   *
   *   net count-DOWN (delta < 0):
   *     DR  INVENTORY_ADJUSTMENT_VARIANCE   |value|   (loss -> P&L)
   *     CR  INVENTORY_ASSET                 |value|   (subledger relieved)
   *
   *   net count-UP (delta > 0):
   *     DR  INVENTORY_ASSET                  value    (subledger added)
   *     CR  INVENTORY_ADJUSTMENT_VARIANCE    value    (gain -> P&L)
   *
   * The variance leg uses a NEW semantic role the shared AccountResolver does not
   * yet enumerate, resolved defensively so a mis-seeded chart throws a clear
   * BadRequest instead of posting to a wrong/zero account.
   */
  private async postAdjustmentLedger(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      divisionId: string | null;
      branchId: string;
      adjustmentId: string;
      adjustmentNumber: string;
      transactionDate: Date;
      inventoryValueDelta: Prisma.Decimal;
      userId: string;
    },
  ): Promise<{ id: string; journalNumber: string } | null> {
    const delta = input.inventoryValueDelta.toDecimalPlaces(2);
    if (delta.isZero()) return null;

    const [inventoryAccount, varianceAccount] = await Promise.all([
      this.accountResolver.resolve(input.companyId, 'INVENTORY_ASSET', tx),
      this.resolveAdjustmentVarianceAccount(input.companyId, tx),
    ]);

    // Two distinct roles must map to two distinct accounts or the JE is a silent
    // no-op that still balances.
    if (inventoryAccount.id === varianceAccount.id) {
      throw new BadRequestException(
        `Chart-of-accounts misconfiguration on company ${input.companyId}: the inventory asset and ` +
          `inventory-adjustment variance accounts resolve to the same account. Configure a distinct ` +
          `account (accountSubType="inventory_adjustment_variance") for the variance leg and retry.`,
      );
    }

    const magnitude = delta.abs();
    const grew = delta.gt(0);
    const lines: PostingLine[] = grew
      ? [
          {
            accountId: inventoryAccount.id,
            description: 'Inventory count-up',
            debit: magnitude,
            credit: 0,
          },
          {
            accountId: varianceAccount.id,
            description: 'Inventory adjustment gain',
            debit: 0,
            credit: magnitude,
          },
        ]
      : [
          {
            accountId: varianceAccount.id,
            description: 'Inventory adjustment loss',
            debit: magnitude,
            credit: 0,
          },
          {
            accountId: inventoryAccount.id,
            description: 'Inventory written off',
            debit: 0,
            credit: magnitude,
          },
        ];

    return this.postingEngine.postLines(
      {
        companyId: input.companyId,
        divisionId: input.divisionId,
        branchId: input.branchId,
        transactionDate: input.transactionDate,
        description: `Stock adjustment ${input.adjustmentNumber}`,
        referenceType: 'StockAdjustment',
        referenceId: input.adjustmentId,
        moduleName: 'stock-adjustments',
        userId: input.userId,
        lines,
      },
      tx,
    );
  }

  /**
   * Resolve the "inventory adjustment variance" account (P&L) used as the
   * counter-leg of a stock-adjustment posting. This is a NEW semantic role the
   * shared AccountResolverService does not (yet) enumerate in its AccountRole
   * union, so we resolve it defensively via a cast: the resolver matches an
   * account whose accountSubType is "inventory_adjustment_variance" (or a
   * conventional code) and otherwise throws. We re-wrap that failure with
   * actionable guidance rather than posting the variance to an arbitrary account.
   */
  private async resolveAdjustmentVarianceAccount(companyId: string, tx: Prisma.TransactionClient) {
    try {
      return await this.accountResolver.resolve(
        companyId,
        'INVENTORY_ADJUSTMENT_VARIANCE' as any,
        tx,
      );
    } catch {
      throw new BadRequestException(
        `Cannot post this stock adjustment: no "inventory adjustment variance" account is ` +
          `configured for company ${companyId}. Create a P&L account (typically an expense/other-loss ` +
          `account) and set accountSubType="inventory_adjustment_variance" on it, then retry.`,
      );
    }
  }

  private async assertReferencesBelongToCompany(
    companyId: string,
    refs: StockAdjustmentReferenceIds,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    if (refs.divisionId) {
      const division = await db.division.findFirst({
        where: { id: refs.divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    if (!refs.branchId) throw new BadRequestException('Branch/location is required');
    const branch = await db.branch.findFirst({
      where: { id: refs.branchId, deletedAt: null, isActive: true },
      select: { divisionId: true, division: { select: { companyId: true } } },
    });
    if (!branch || branch.division.companyId !== companyId) {
      throw new BadRequestException('Branch does not belong to this company');
    }
    if (refs.divisionId && branch.divisionId !== refs.divisionId) {
      throw new BadRequestException('Branch does not belong to the selected division');
    }
    await this.assertLineReferencesBelongToCompany(companyId, refs.lines, db);
    return { divisionId: branch.divisionId };
  }

  private validateLines(lines: StockAdjustmentLineDto[]) {
    if (!Array.isArray(lines) || !lines.length)
      throw new BadRequestException('Add at least one count line');
    const seen = new Set<string>();
    for (const line of lines) {
      if (!line.productId || !line.unitId || seen.has(line.productId)) {
        throw new BadRequestException('Each product must appear exactly once with a base unit');
      }
      seen.add(line.productId);
      normalizeAdjustmentLine(line);
    }
  }

  private requestFingerprint(dto: CreateStockAdjustmentDto) {
    const payload = {
      companyId: dto.companyId,
      divisionId: dto.divisionId ?? null,
      branchId: dto.branchId,
      reason: dto.reason,
      notes: dto.notes ?? null,
      lines: dto.lines
        .map((line) => {
          const normalized = normalizeAdjustmentLine(line);
          return {
            productId: line.productId,
            unitId: line.unitId,
            systemQuantity: normalized.systemQuantity ?? null,
            countedQuantity: normalized.countedQuantity,
            unitCost: normalized.unitCost ?? null,
            expectedRevision: line.expectedRevision ?? null,
            reason: line.reason ?? null,
          };
        })
        .sort((a, b) => a.productId.localeCompare(b.productId)),
    };
    // Audit's secret scrubber intentionally redacts opaque hex strings. A
    // digest encoded as 32 byte integers is provenance and survives that DLP.
    return Array.from(createHash('sha256').update(JSON.stringify(payload)).digest());
  }

  private capturedFingerprint(
    record: Prisma.StockAdjustmentGetPayload<{ include: { lines: true } }>,
  ) {
    const payload = {
      companyId: record.companyId,
      divisionId: record.divisionId ?? null,
      branchId: record.branchId,
      reason: record.reason,
      notes: record.notes ?? null,
      lines: record.lines
        .map((line) => ({
          productId: line.productId,
          unitId: line.unitId,
          systemQuantity: line.systemQuantity.toString(),
          countedQuantity: line.countedQuantity.toString(),
          varianceQuantity: line.varianceQuantity.toString(),
          unitCost: line.unitCost?.toString() ?? null,
          reason: line.reason ?? null,
        }))
        .sort((a, b) => a.productId.localeCompare(b.productId)),
    };
    return Array.from(createHash('sha256').update(JSON.stringify(payload)).digest());
  }

  /** Product locks are held before this read, including for an absent tuple. */
  private async captureLines(
    tx: Prisma.TransactionClient,
    companyId: string,
    branchId: string,
    lines: StockAdjustmentLineDto[],
  ) {
    const captured: Prisma.StockAdjustmentLineCreateWithoutStockAdjustmentInput[] = [];
    for (const line of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const normalized = normalizeAdjustmentLine(line);
      const rows = await tx.$queryRaw<
        Array<{ quantityOnHand: Prisma.Decimal; physicalRevision: number }>
      >(Prisma.sql`
        SELECT "quantityOnHand", "physicalRevision" FROM inventory_balances
        WHERE "companyId" = ${companyId} AND "productId" = ${line.productId} AND "branchId" = ${branchId} FOR UPDATE
      `);
      const quantity = rows[0]?.quantityOnHand ?? new Prisma.Decimal(0);
      const revision = rows[0]?.physicalRevision ?? 0;
      const varianceQuantity = new Prisma.Decimal(normalized.countedQuantity).minus(quantity);
      if (varianceQuantity.abs().gte('100000000000000'))
        throw new BadRequestException('The discrepancy exceeds the supported quantity range');
      if (
        (line.expectedRevision !== undefined && line.expectedRevision !== revision) ||
        (normalized.systemQuantity !== undefined && !quantity.eq(normalized.systemQuantity))
      ) {
        throw new ConflictException({
          code: 'STOCK_CAPTURE_STALE',
          message:
            'Stock changed since this count was opened. Refresh the quantity and count again.',
        });
      }
      captured.push({
        product: { connect: { id: line.productId } },
        unit: { connect: { id: line.unitId } },
        systemQuantity: quantity,
        countedQuantity: normalized.countedQuantity,
        varianceQuantity,
        unitCost: normalized.unitCost,
        reason: line.reason,
      });
    }
    return captured;
  }

  private async assertLineReferencesBelongToCompany(
    companyId: string,
    lines: StockAdjustmentLineDto[] | undefined,
    db: Prisma.TransactionClient,
  ) {
    if (!lines?.length) return;

    const unique = (ids: string[]) => Array.from(new Set(ids));
    const productIds = unique(lines.map((line) => line.productId));
    const unitIds = unique(lines.map((line) => line.unitId));

    const [products, units] = await Promise.all([
      db.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: {
          id: true,
          companyId: true,
          baseUnitId: true,
          trackInventory: true,
          productType: true,
          status: true,
        },
      }),
      db.unitOfMeasure.findMany({
        where: { id: { in: unitIds }, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, companyId: true },
      }),
    ]);

    const validProductIds = new Set(
      products.filter((product) => product.companyId === companyId).map((product) => product.id),
    );
    if (validProductIds.size !== productIds.length) {
      throw new BadRequestException('Stock adjustment product does not belong to this company');
    }
    const productsById = new Map(products.map((product) => [product.id, product]));
    for (const line of lines) {
      const product = productsById.get(line.productId)!;
      if (product.baseUnitId !== line.unitId)
        throw new BadRequestException('Stock counts must use the product base unit');
      if (
        !product.trackInventory ||
        ['SERVICE', 'NON_STOCK_ITEM'].includes(product.productType) ||
        product.status !== 'ACTIVE'
      ) {
        throw new BadRequestException('Only active inventory-tracked goods can be counted');
      }
    }

    const validUnitIds = new Set(
      units
        .filter((unit) => unit.companyId === null || unit.companyId === companyId)
        .map((unit) => unit.id),
    );
    if (validUnitIds.size !== unitIds.length) {
      throw new BadRequestException('Stock adjustment unit does not belong to this company');
    }
  }
}
