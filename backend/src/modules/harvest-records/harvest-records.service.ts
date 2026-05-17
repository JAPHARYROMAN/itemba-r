import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { CreateHarvestRecordDto } from './dto/create-harvest-record.dto';
import { UpdateHarvestRecordDto } from './dto/update-harvest-record.dto';
import { HarvestRecordStatus, InventoryMovementType } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

@Injectable()
export class HarvestRecordsService {
  private readonly logger = new Logger(HarvestRecordsService.name);
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private codes: EntityCodeGeneratorService,
    private postingEngine: PostingEngineService,
  ) {}

  async create(dto: CreateHarvestRecordDto, userId: string) {
    const harvestNumber = await this.codes.next({
      entityType: 'HarvestRecord',
      companyId: dto.companyId,
    });
    const harvest = await this.prisma.harvestRecord.create({
      data: { ...dto, harvestNumber, harvestDate: new Date(dto.harvestDate), createdById: userId },
    });
    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'HarvestRecord',
      entityId: harvest.id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return harvest;
  }

  async findAll(
    cropSeasonId?: string,
    farmId?: string,
    companyId?: string,
    page = 1,
    limit = 20,
    user?: any,
  ) {
    const where: any = { deletedAt: null };
    if (cropSeasonId) where.cropSeasonId = cropSeasonId;
    if (farmId) where.farmId = farmId;
    applyCompanyScopeWhere(where, user, companyId);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.harvestRecord.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { harvestDate: 'desc' },
        include: {
          farm: { select: { name: true } },
          cropSeason: { select: { seasonName: true } },
          unit: { select: { symbol: true } },
        },
      }),
      this.prisma.harvestRecord.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const h = await this.prisma.harvestRecord.findFirst({
      where: { id, deletedAt: null },
      include: { farm: true, field: true, cropSeason: true, product: true, unit: true },
    });
    if (!h) throw new NotFoundException('Harvest record not found');
    return h;
  }

  async submit(id: string, userId: string) {
    const h = await this.findOne(id);
    if (h.status !== HarvestRecordStatus.DRAFT)
      throw new BadRequestException('Only DRAFT harvests can be submitted');
    const updated = await this.prisma.harvestRecord.update({
      where: { id },
      data: { status: HarvestRecordStatus.SUBMITTED },
    });
    await this.audit.log({
      userId,
      action: 'SUBMIT',
      entityType: 'HarvestRecord',
      entityId: id,
      newValue: {},
    });
    return updated;
  }

  async approve(id: string, userId: string) {
    const h = await this.findOne(id);
    if (h.status !== HarvestRecordStatus.SUBMITTED)
      throw new BadRequestException('Only SUBMITTED harvests can be approved');
    const updated = await this.prisma.harvestRecord.update({
      where: { id },
      data: { status: HarvestRecordStatus.APPROVED, approvedById: userId },
    });
    await this.audit.log({
      userId,
      action: 'APPROVE',
      entityType: 'HarvestRecord',
      entityId: id,
      newValue: {},
    });
    return updated;
  }

  /**
   * Post an APPROVED harvest into inventory + GL (Sprint I5).
   *
   * Inventory side: PRODUCTION_IN movement carries unit/total cost (from
   * `estimatedUnitValue`), and the InventoryBalance is updated with both
   * quantity AND totalValue so weighted-average cost stays correct for
   * downstream sales (COGS draws from averageCost).
   *
   * GL side: posts a balanced JE
   *    Dr 1200 Inventory                 estimatedTotalValue
   *       Cr 4200 Crop Production Income  estimatedTotalValue
   *
   * If `estimatedUnitValue` is null/0, the inventory qty still moves but
   * cost basis stays at its prior averageCost and the JE is skipped (with
   * a logged warning) — operator can re-cost via a manual adjustment.
   *
   * Soft-fails the JE if 1200 or 4200 are missing from the COA so the
   * physical production posting still completes.
   */
  async post(id: string, userId: string) {
    const h = await this.findOne(id);
    if (h.status !== HarvestRecordStatus.APPROVED)
      throw new BadRequestException('Only APPROVED harvests can be posted');
    if (!h.productId || !h.branchId)
      throw new BadRequestException('Product and branch/location are required to post harvest');

    const quantity = Number(h.quantity);
    const unitValue = Number(h.estimatedUnitValue ?? 0);
    const totalValue = round2(
      h.estimatedTotalValue != null ? Number(h.estimatedTotalValue) : unitValue * quantity,
    );
    const hasCostBasis = unitValue > 0 && totalValue > 0;

    let journalEntryId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      // Inventory movement — PRODUCTION_IN. Carry cost so downstream COGS works.
      const movementNumber = await this.codes.next({
        entityType: 'InventoryMovement',
        companyId: h.companyId,
        tx,
      });
      await tx.inventoryMovement.create({
        data: {
          movementNumber,
          companyId: h.companyId,
          divisionId: h.divisionId,
          branchId: h.branchId,
          productId: h.productId!,
          movementType: InventoryMovementType.PRODUCTION_IN,
          quantity,
          unitId: h.unitId,
          unitCost: hasCostBasis ? unitValue : undefined,
          totalCost: hasCostBasis ? totalValue : undefined,
          movementDate: h.harvestDate,
          referenceType: 'HarvestRecord',
          referenceId: id,
          notes: `Harvest posting: ${h.harvestNumber}`,
          createdById: userId,
        },
      });

      // Inventory balance: increment qty AND value, then recompute
      // weighted-average cost so sales draw the right COGS.
      const existing = await tx.inventoryBalance.findFirst({
        where: {
          companyId: h.companyId,
          productId: h.productId!,
          branchId: h.branchId,
        },
      });
      if (existing) {
        const newQty = round4(Number(existing.quantityOnHand) + quantity);
        const newTotalValue = round2(Number(existing.totalValue) + (hasCostBasis ? totalValue : 0));
        const newAverage =
          newQty > 0 ? round4(newTotalValue / newQty) : Number(existing.averageCost);
        await tx.inventoryBalance.update({
          where: { id: existing.id },
          data: {
            quantityOnHand: newQty,
            totalValue: newTotalValue,
            averageCost: newAverage,
            lastMovementAt: new Date(),
          },
        });
      } else {
        await tx.inventoryBalance.create({
          data: {
            companyId: h.companyId,
            productId: h.productId!,
            branchId: h.branchId,
            quantityOnHand: quantity,
            totalValue: hasCostBasis ? totalValue : 0,
            averageCost: hasCostBasis ? unitValue : 0,
            lastMovementAt: new Date(),
          },
        });
      }

      // Crop season actual yield bookkeeping.
      await tx.cropSeason.update({
        where: { id: h.cropSeasonId },
        data: { actualYield: { increment: quantity } },
      });

      // GL — Dr 1200 Inventory / Cr 4200 Crop Production Income.
      if (hasCostBasis) {
        const accounts = await tx.chartOfAccount.findMany({
          where: {
            companyId: h.companyId,
            deletedAt: null,
            accountCode: { in: ['1200', '4200'] },
          },
          select: { id: true, accountCode: true },
        });
        const inventoryAssetId = accounts.find((a) => a.accountCode === '1200')?.id;
        const cropIncomeId = accounts.find((a) => a.accountCode === '4200')?.id;
        if (inventoryAssetId && cropIncomeId) {
          const journalNumber = await this.codes.next({
            entityType: 'JournalEntry',
            companyId: h.companyId,
            tx,
          });
          const je = await this.postingEngine.postLines(
            {
              journalNumber,
              companyId: h.companyId,
              transactionDate: h.harvestDate,
              description: `Harvest ${h.harvestNumber} — ${h.farm.name}`,
              referenceType: 'HarvestRecord',
              referenceId: id,
              status: 'DRAFT',
              userId,
              moduleName: 'harvest_records',
              lines: [
                {
                  accountId: inventoryAssetId,
                  description: `Harvested produce — ${h.product?.name ?? 'crop'}`,
                  debit: totalValue,
                  credit: 0,
                },
                {
                  accountId: cropIncomeId,
                  description: `Production income — ${h.harvestNumber}`,
                  debit: 0,
                  credit: totalValue,
                },
              ],
            },
            tx,
          );
          journalEntryId = je.id;
        } else {
          this.logger.warn(`Harvest ${h.harvestNumber}: COA missing 1200 or 4200 — JE skipped`);
        }
      } else {
        this.logger.warn(
          `Harvest ${h.harvestNumber}: no estimatedUnitValue — booking qty without cost/JE. Re-cost via manual adjustment if needed.`,
        );
      }

      await tx.harvestRecord.update({
        where: { id },
        data: { status: HarvestRecordStatus.POSTED, postedById: userId },
      });
    });

    await this.audit.log({
      userId,
      action: 'POST',
      entityType: 'HarvestRecord',
      entityId: id,
      newValue: {
        inventoryEffect: 'PRODUCTION_IN',
        quantity,
        totalValue: hasCostBasis ? totalValue : 0,
        journalEntryId,
      } as unknown as Record<string, unknown>,
    });
    return this.findOne(id);
  }

  async reject(id: string, userId: string) {
    const h = await this.findOne(id);
    if (
      !([HarvestRecordStatus.SUBMITTED, HarvestRecordStatus.APPROVED] as string[]).includes(
        h.status,
      )
    )
      throw new BadRequestException('Cannot reject in current state');
    const updated = await this.prisma.harvestRecord.update({
      where: { id },
      data: { status: HarvestRecordStatus.REJECTED },
    });
    await this.audit.log({
      userId,
      action: 'REJECT',
      entityType: 'HarvestRecord',
      entityId: id,
      newValue: {},
    });
    return updated;
  }

  async update(id: string, dto: UpdateHarvestRecordDto, userId: string) {
    const h = await this.findOne(id);
    if (h.status === HarvestRecordStatus.POSTED)
      throw new BadRequestException('Cannot update a posted harvest record');
    const updated = await this.prisma.harvestRecord.update({
      where: { id },
      data: { ...dto, harvestDate: dto.harvestDate ? new Date(dto.harvestDate) : undefined },
    });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entityType: 'HarvestRecord',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async remove(id: string, userId: string) {
    const h = await this.findOne(id);
    if (h.status === HarvestRecordStatus.POSTED)
      throw new BadRequestException('Cannot delete a posted harvest record');
    await this.prisma.harvestRecord.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId,
      action: 'DELETE',
      entityType: 'HarvestRecord',
      entityId: id,
      newValue: {},
    });
    return { message: 'Harvest record deleted' };
  }
}
