import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { CreateStockDamageDto } from './dto/create-stock-damage.dto';
import { UpdateStockDamageDto } from './dto/update-stock-damage.dto';
import { QueryStockDamageDto } from './dto/query-stock-damage.dto';
import {
  applyCompanyScopeWhere,
  AccountResolverService,
  CompanyScopeService,
} from '../../common/services';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';

interface InventoryBalanceValueRow {
  totalValue: Prisma.Decimal;
}

type StockDamageReferenceIds = {
  branchId?: string | null;
  productId?: string | null;
  unitId?: string | null;
  batchId?: string | null;
};

@Injectable()
export class StockDamageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly companyScope: CompanyScopeService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
  ) {}

  /**
   * Read the current inventory subledger VALUE (totalValue) for a
   * company/product/branch line under a row lock (FOR UPDATE), returning 0 when
   * no balance row exists yet. Used to MEASURE the exact GL swing a DAMAGE
   * movement produces (see post()): read before and after the movement and post
   * the delta, so the GL credit to INVENTORY_ASSET ties to the subledger relief
   * to the cent. The lock is held for the whole transaction, serialising
   * concurrent posts against the same balance row.
   */
  private async readBalanceValueForUpdate(
    tx: Prisma.TransactionClient,
    companyId: string,
    productId: string,
    branchId: string,
  ): Promise<Prisma.Decimal> {
    const rows = await tx.$queryRaw<InventoryBalanceValueRow[]>(Prisma.sql`
      SELECT "totalValue"
      FROM "inventory_balances"
      WHERE "companyId" = ${companyId}
        AND "productId" = ${productId}
        AND "branchId" = ${branchId}
      FOR UPDATE
    `);
    return rows[0] ? new Prisma.Decimal(rows[0].totalValue) : new Prisma.Decimal(0);
  }

  private async generateDamageNumber(companyId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.stockDamage.count({
      where: { companyId, damageNumber: { startsWith: `DMG-${year}` } },
    });
    return `DMG-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  // ITMB-audit: verify every client-supplied reference (branch, product, unit,
  // batch) belongs to the damage record's company (and, for the batch, the same
  // product/branch) so a caller cannot bind another company's rows to a record
  // and later corrupt/deplete them on post.
  private async assertReferencesBelongToCompany(
    companyId: string,
    refs: StockDamageReferenceIds,
  ) {
    if (refs.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: refs.branchId, deletedAt: null },
        select: { division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== companyId) {
        throw new BadRequestException('Branch does not belong to this company');
      }
    }

    if (refs.productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: refs.productId, deletedAt: null },
        select: { companyId: true },
      });
      if (!product || product.companyId !== companyId) {
        throw new BadRequestException('Product does not belong to this company');
      }
    }

    if (refs.unitId) {
      const unit = await this.prisma.unitOfMeasure.findFirst({
        where: { id: refs.unitId, deletedAt: null, status: 'ACTIVE' },
        select: { companyId: true },
      });
      if (!unit || (unit.companyId !== null && unit.companyId !== companyId)) {
        throw new BadRequestException('Unit does not belong to this company');
      }
    }

    if (refs.batchId) {
      const batch = await this.prisma.productBatch.findFirst({
        where: { id: refs.batchId, deletedAt: null },
        select: { companyId: true, productId: true, branchId: true },
      });
      if (!batch || batch.companyId !== companyId) {
        throw new BadRequestException('Batch does not belong to this company');
      }
      if (refs.productId && batch.productId !== refs.productId) {
        throw new BadRequestException('Batch does not belong to the selected product');
      }
      if (refs.branchId && batch.branchId && batch.branchId !== refs.branchId) {
        throw new BadRequestException('Batch does not belong to the selected branch');
      }
    }
  }

  async create(dto: CreateStockDamageDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(dto.companyId, {
      branchId: dto.branchId,
      productId: dto.productId,
      unitId: dto.unitId,
      batchId: dto.batchId,
    });
    const userId = user.id;
    const damageNumber = await this.generateDamageNumber(dto.companyId);
    const record = await this.prisma.stockDamage.create({
      data: {
        damageNumber,
        companyId: dto.companyId,
        branchId: dto.branchId,
        productId: dto.productId,
        batchId: dto.batchId,
        quantity: dto.quantity,
        unitId: dto.unitId,
        damageType: dto.damageType,
        estimatedValue: dto.estimatedValue,
        reportedById: userId,
        status: 'DRAFT',
        notes: dto.notes,
      },
    });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_CREATE',
      entityType: 'StockDamage',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async findAll(query: QueryStockDamageDto, user?: any) {
    const { page = 1, limit = 20, companyId, branchId, status, productId } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (productId) where.productId = productId;

    const [data, total] = await Promise.all([
      this.prisma.stockDamage.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockDamage.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.stockDamage.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Stock damage not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }
    return record;
  }

  async update(id: string, dto: UpdateStockDamageDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Can only update DRAFT records');
    // companyId is immutable on update; validate any changed references against
    // the record's own company (never a client-supplied companyId).
    await this.assertReferencesBelongToCompany(existing.companyId, {
      branchId: dto.branchId ?? existing.branchId,
      productId: dto.productId ?? existing.productId,
      unitId: dto.unitId ?? existing.unitId,
      batchId: dto.batchId !== undefined ? dto.batchId : existing.batchId,
    });
    const record = await this.prisma.stockDamage.update({
      where: { id },
      data: {
        ...(dto.branchId && { branchId: dto.branchId }),
        ...(dto.productId && { productId: dto.productId }),
        ...(dto.batchId !== undefined && { batchId: dto.batchId }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.unitId && { unitId: dto.unitId }),
        ...(dto.damageType && { damageType: dto.damageType }),
        ...(dto.estimatedValue !== undefined && { estimatedValue: dto.estimatedValue }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_UPDATE',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return record;
  }

  async submit(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT records can be submitted');
    const record = await this.prisma.stockDamage.update({
      where: { id },
      data: { status: 'SUBMITTED' },
    });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_SUBMIT',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'SUBMITTED' } as any,
    });
    return record;
  }

  async approve(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'SUBMITTED')
      throw new BadRequestException('Only SUBMITTED records can be approved');
    const record = await this.prisma.stockDamage.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_APPROVE',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: record.companyId,
    });
    return record;
  }

  async reject(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'SUBMITTED')
      throw new BadRequestException('Only SUBMITTED records can be rejected');
    const record = await this.prisma.stockDamage.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_REJECT',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: record.companyId,
    });
    return record;
  }

  async post(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'APPROVED')
      throw new BadRequestException('Only APPROVED records can be posted');

    const { companyId, productId, branchId, unitId, quantity, batchId } = existing;
    if (!branchId) {
      throw new BadRequestException('Branch/location is required to post stock damage');
    }

    const damageQty = Number(quantity);
    const movementDate = new Date();

    // ITMB-043: Perform the movement, batch decrement and status flip in ONE transaction
    // so they commit or roll back together. Claim the document atomically (guarded on
    // status === APPROVED) so concurrent/retried posts cannot remove stock twice, and gate
    // the batch decrement on availability so remainingQuantity can never go negative.
    const record = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockDamage.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'POSTED' },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Only APPROVED records can be posted');
      }

      // ITMB-audit (GL): the DAMAGE movement below relieves the inventory
      // subledger's totalValue at weighted-average cost but posts NO journal
      // entry, so the GL Inventory Asset and P&L drift from the subledger on
      // every post. Rather than RE-DERIVE the relieved value with an independent
      // WAC formula (min(qty*avg, totalValue)) — which can diverge from
      // applyMovementToBalance by rounding and in edge cases (e.g. the movement
      // forces totalValue to zero when qty hits zero, or the qty*avg invariant
      // was broken by a prior cost-less inbound) — we MEASURE the actual relief:
      // read the subledger totalValue (locked FOR UPDATE) immediately before the
      // movement, apply the movement, then re-read totalValue and post the exact
      // delta. This guarantees the GL credit to INVENTORY_ASSET equals the
      // subledger reduction to the cent. (Mirrors stock-adjustments.post.)
      const beforeValue = await this.readBalanceValueForUpdate(
        tx,
        companyId,
        productId,
        branchId,
      );

      await this.inventoryMovements.createMovement({
        companyId,
        productId,
        branchId,
        movementType: 'DAMAGE',
        quantity: damageQty,
        unitId,
        movementDate,
        createdById: userId,
        referenceType: 'StockDamage',
        referenceId: id,
        tx,
      });

      const afterValue = await this.readBalanceValueForUpdate(
        tx,
        companyId,
        productId,
        branchId,
      );
      // Relief = before - after (>= 0 for an outbound DAMAGE). Round to money
      // precision (2 dp) so the balanced JE ties to the cent.
      const writeOffValue = beforeValue.minus(afterValue).toDecimalPlaces(2);

      // Post the matching GL swing IN THE SAME TRANSACTION so the subledger and
      // GL never diverge. A stock damage is a physical write-off:
      //   DR damage/write-off expense (P&L loss)   [GENERAL_EXPENSE]
      //   CR Inventory Asset (relieve the subledger) [INVENTORY_ASSET]
      // Both legs use the EXACT value relieved from the subledger above
      // (before - after). When there is no cost basis (writeOffValue == 0) there
      // is nothing to relieve and no balanced entry to post, so the GL leg is
      // skipped (mirrors the subledger, which also relieved zero in that case).
      let journalEntryId: string | null = null;
      if (writeOffValue.gt(0)) {
        const branch = await tx.branch.findFirst({
          where: { id: branchId },
          select: { divisionId: true },
        });
        const accounts = await this.accountResolver.resolveMany(
          companyId,
          ['GENERAL_EXPENSE', 'INVENTORY_ASSET'],
          tx,
        );
        const je = await this.postingEngine.postLines(
          {
            companyId,
            divisionId: branch?.divisionId ?? null,
            branchId,
            transactionDate: movementDate,
            description: `Stock damage write-off ${existing.damageNumber}`,
            referenceType: 'StockDamage',
            referenceId: id,
            moduleName: 'stock-damage',
            userId,
            lines: [
              {
                accountId: accounts.GENERAL_EXPENSE.id,
                description: 'Stock damage write-off',
                debit: writeOffValue,
                credit: 0,
              },
              {
                accountId: accounts.INVENTORY_ASSET.id,
                description: 'Inventory relieved (damage)',
                debit: 0,
                credit: writeOffValue,
              },
            ],
          },
          tx,
        );
        journalEntryId = je.id;
      }

      if (batchId) {
        // ITMB-audit: only decrement a batch that belongs to the same company,
        // product and (when set) branch as the damage record, so a mismatched
        // batchId can never deplete an unrelated / cross-company batch.
        const res = await tx.productBatch.updateMany({
          where: {
            id: batchId,
            companyId,
            productId,
            ...(branchId ? { branchId } : {}),
            remainingQuantity: { gte: damageQty },
          },
          data: { remainingQuantity: { decrement: damageQty } },
        });
        if (res.count === 0) {
          const batch = await tx.productBatch.findFirst({
            where: { id: batchId },
            select: { companyId: true, productId: true, branchId: true },
          });
          if (
            !batch ||
            batch.companyId !== companyId ||
            batch.productId !== productId ||
            (branchId && batch.branchId && batch.branchId !== branchId)
          ) {
            throw new BadRequestException(
              'Batch does not belong to this damage record (company/product/branch mismatch)',
            );
          }
          throw new BadRequestException('Insufficient batch quantity');
        }
      }

      const updated = await tx.stockDamage.update({
        where: { id },
        data: { status: 'POSTED' },
      });
      return { updated, journalEntryId };
    });

    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_POST',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: record.updated.companyId,
      // StockDamage has no journalEntryId column (schema unchanged this wave);
      // record the posted JE id in the audit trail so the GL entry stays
      // traceable to the source document.
      newValue: { status: 'POSTED', journalEntryId: record.journalEntryId } as any,
    });
    return record.updated;
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT records can be deleted');
    await this.prisma.stockDamage.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_DELETE',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return { success: true };
  }
}
