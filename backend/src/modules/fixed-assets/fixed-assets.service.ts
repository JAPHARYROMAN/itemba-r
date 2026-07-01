import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccessLevel,
  AssetFinancingStatus,
  AssetOwnershipLevel,
  FixedAssetStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountResolverService, CompanyScopeService } from '../../common/services';
import { AccountRole } from '../../common/services/account-resolver.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { QueryFixedAssetDto } from './dto/query-fixed-asset.dto';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { MarkCollateralDto } from './dto/mark-collateral.dto';
import {
  CapitalizeFixedAssetDto,
  FixedAssetCapitalizationSource,
} from './dto/capitalize-fixed-asset.dto';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';

const ASSET_INCLUDES = {
  company: { select: { id: true, name: true, code: true } },
  group: { select: { id: true, name: true, code: true } },
  division: { select: { id: true, name: true, code: true } },
  branch: { select: { id: true, name: true } },
};

/**
 * Statuses an asset can be disposed FROM. Anything already in a terminal
 * disposal status (SOLD/DISPOSED/WRITTEN_OFF/LOST/TRANSFERRED) must not be
 * re-disposed, or the GL cost / accumulated depreciation would be relieved
 * twice.
 */
const DISPOSABLE_STATUSES: FixedAssetStatus[] = [
  FixedAssetStatus.ACTIVE,
  FixedAssetStatus.UNDER_MAINTENANCE,
];

@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly accountResolver: AccountResolverService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async findAll(query: QueryFixedAssetDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      ownershipLevel,
      category,
      status,
      collateralStatus,
      insuranceStatus,
      financingStatus,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.FixedAssetWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (ownershipLevel) where.ownershipLevel = ownershipLevel;
    if (category) where.category = category;
    if (status) where.status = status;
    if (collateralStatus) where.collateralStatus = collateralStatus;
    if (insuranceStatus) where.insuranceStatus = insuranceStatus;
    if (financingStatus) where.financingStatus = financingStatus;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { assetCode: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { registrationNo: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        include: ASSET_INCLUDES,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser) {
    const record = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...ASSET_INCLUDES,
        documents: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!record) throw new NotFoundException('Fixed asset not found');

    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId);
      await this.audit.log({
        action: 'fixed_asset.view',
        entityType: 'FixedAsset',
        entityId: id,
        userId: user.id,
        companyId: record.companyId ?? undefined,
        metadata: { assetCode: record.assetCode, name: record.name },
      });
    }
    return record;
  }

  async create(dto: CreateFixedAssetDto, user: AuthUser) {
    const {
      acquisitionCost,
      currentBookValue,
      depreciationRate,
      residualValue,
      acquisitionDate,
      ...rest
    } = dto;

    if (dto.ownershipLevel === AssetOwnershipLevel.COMPANY && !dto.companyId) {
      throw new BadRequestException('companyId is required for COMPANY-owned assets');
    }
    if (dto.ownershipLevel === AssetOwnershipLevel.GROUP && !dto.groupId) {
      throw new BadRequestException('groupId is required for GROUP-owned assets');
    }
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const createdById = user.id;

    const asset = await this.prisma.fixedAsset.create({
      data: {
        ...rest,
        acquisitionCost: new Prisma.Decimal(acquisitionCost),
        currentBookValue: new Prisma.Decimal(currentBookValue),
        acquisitionDate: new Date(acquisitionDate),
        ...(depreciationRate && { depreciationRate: new Prisma.Decimal(depreciationRate) }),
        ...(residualValue && { residualValue: new Prisma.Decimal(residualValue) }),
        createdById,
      },
      include: ASSET_INCLUDES,
    });

    await this.audit.log({
      action: 'fixed_asset.create',
      entityType: 'FixedAsset',
      entityId: asset.id,
      userId: createdById,
      companyId: asset.companyId ?? undefined,
      newValue: { assetCode: asset.assetCode, name: asset.name, category: asset.category },
    });

    return asset;
  }

  async update(id: string, dto: UpdateFixedAssetDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const userId = user.id;
    const {
      acquisitionCost,
      currentBookValue,
      depreciationRate,
      residualValue,
      acquisitionDate,
      ...rest
    } = dto;

    const updated = await this.prisma.fixedAsset.update({
      where: { id },
      data: {
        ...rest,
        ...(acquisitionCost && { acquisitionCost: new Prisma.Decimal(acquisitionCost) }),
        ...(currentBookValue && { currentBookValue: new Prisma.Decimal(currentBookValue) }),
        ...(acquisitionDate && { acquisitionDate: new Date(acquisitionDate) }),
        ...(depreciationRate && { depreciationRate: new Prisma.Decimal(depreciationRate) }),
        ...(residualValue && { residualValue: new Prisma.Decimal(residualValue) }),
      },
      include: ASSET_INCLUDES,
    });

    await this.audit.log({
      action: 'fixed_asset.update',
      entityType: 'FixedAsset',
      entityId: id,
      userId,
      companyId: existing.companyId ?? undefined,
      oldValue: { status: existing.status, collateralStatus: existing.collateralStatus },
      newValue: { status: updated.status, collateralStatus: updated.collateralStatus },
    });

    return updated;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    await this.prisma.fixedAsset.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      action: 'fixed_asset.delete',
      entityType: 'FixedAsset',
      entityId: id,
      userId,
      companyId: existing.companyId ?? undefined,
      metadata: { assetCode: existing.assetCode, name: existing.name },
    });
    return { success: true };
  }

  async dispose(id: string, dto: DisposeAssetDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;

    // Guard: an asset can only be disposed from a "live" state. This blocks
    // double-disposal (which would double-relieve the GL cost / accumulated
    // depreciation). The actual DRAFT->disposed flip is claimed atomically
    // inside the transaction below via updateMany.
    if (!DISPOSABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        `Fixed asset ${existing.assetCode} is already ${existing.status} and cannot be disposed again`,
      );
    }

    const disposalDate = new Date(dto.disposalDate);
    const proceeds = dto.disposalValue
      ? new Prisma.Decimal(dto.disposalValue).toDecimalPlaces(2)
      : new Prisma.Decimal(0);
    if (proceeds.lt(0)) {
      throw new BadRequestException('Disposal value cannot be negative');
    }

    const { updated, journalEntry } = await this.prisma.$transaction(async (tx) => {
      // Atomic status claim: only one transaction can move the asset out of a
      // live status. The loser sees count === 0 and aborts before posting any
      // GL swing, preventing a double-relief of cost / accumulated depreciation.
      const claimed = await tx.fixedAsset.updateMany({
        where: { id, status: { in: DISPOSABLE_STATUSES }, deletedAt: null },
        data: {
          status: dto.disposalStatus,
          disposalDate,
          disposalValue: proceeds,
          // Book value is now fully relieved from the register on disposal.
          currentBookValue: new Prisma.Decimal(0),
          ...(dto.notes && { notes: dto.notes }),
        },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(
          `Fixed asset ${existing.assetCode} is no longer in a disposable state`,
        );
      }

      const journalEntry = await this.postDisposalLedger(tx, existing, {
        disposalDate,
        proceeds,
        userId: user.id,
      });

      const updated = await tx.fixedAsset.findFirst({
        where: { id },
        include: ASSET_INCLUDES,
      });
      return { updated, journalEntry };
    });

    await this.audit.log({
      action: 'fixed_asset.dispose',
      entityType: 'FixedAsset',
      entityId: id,
      userId,
      companyId: existing.companyId ?? undefined,
      oldValue: { status: existing.status },
      newValue: {
        status: dto.disposalStatus,
        disposalDate: dto.disposalDate,
        disposalValue: proceeds.toString(),
        journalEntryId: journalEntry?.id ?? null,
      },
    });

    return updated;
  }

  /**
   * Post the balanced disposal journal entry that relieves the GL of the asset
   * that {@link capitalize} put there and recognizes any gain/loss:
   *
   *   CR  Fixed Asset               (acquisitionCost — remove the asset)
   *   DR  Accumulated Depreciation  (posted contra — remove it)
   *   DR  Cash on hand              (disposalValue proceeds, if any)
   *   DR  Loss on disposal          (balancing figure when proceeds < NBV)
   *     — or —
   *   CR  Gain on disposal          (balancing figure when proceeds > NBV)
   *
   * where net book value (NBV) = acquisitionCost − accumulated depreciation as
   * carried in the GL. Accumulated depreciation is read from the asset's
   * DepreciationSchedule rows (the same figure the depreciation poster credited
   * to ACCUMULATED_DEPRECIATION), so the swing exactly matches what is in the
   * GL. Returns null (posting skipped) for assets that were never capitalized
   * into the GL — there is no cost/contra to relieve in that case.
   */
  private async postDisposalLedger(
    tx: Prisma.TransactionClient,
    asset: { id: string; companyId: string | null; divisionId: string | null; branchId: string | null; assetCode: string; name: string; acquisitionCost: Prisma.Decimal },
    opts: { disposalDate: Date; proceeds: Prisma.Decimal; userId: string },
  ): Promise<{ id: string; journalNumber: string } | null> {
    // Only company-owned, capitalized assets have a GL cost/contra to relieve.
    if (!asset.companyId) return null;

    const capitalization = await tx.journalEntry.findFirst({
      where: {
        companyId: asset.companyId,
        referenceType: 'FixedAsset',
        referenceId: asset.id,
        deletedAt: null,
        status: 'POSTED',
      },
      select: { id: true },
    });
    // Not capitalized into the GL — nothing to relieve. The subledger status
    // change still stands; flagged in the audit trail via journalEntryId=null.
    if (!capitalization) return null;

    // Idempotency: never post a second disposal JE for the same asset.
    const existingDisposal = await tx.journalEntry.findFirst({
      where: {
        companyId: asset.companyId,
        referenceType: 'FixedAssetDisposal',
        referenceId: asset.id,
        deletedAt: null,
        status: { in: ['DRAFT', 'POSTED'] },
      },
      select: { id: true, journalNumber: true },
    });
    if (existingDisposal) return existingDisposal;

    const cost = new Prisma.Decimal(asset.acquisitionCost).toDecimalPlaces(2);

    // Accumulated depreciation as carried in the GL = sum of the asset's
    // DepreciationSchedule.accumulatedDepreciation (what the depreciation
    // poster credited to ACCUMULATED_DEPRECIATION). Capped at cost so a
    // mis-seeded schedule can never over-relieve the contra account.
    const depAgg = await tx.depreciationSchedule.aggregate({
      where: { fixedAssetId: asset.id, companyId: asset.companyId, deletedAt: null },
      _sum: { accumulatedDepreciation: true },
    });
    let accumulatedDepreciation = new Prisma.Decimal(
      depAgg._sum.accumulatedDepreciation ?? 0,
    ).toDecimalPlaces(2);
    if (accumulatedDepreciation.gt(cost)) accumulatedDepreciation = cost;
    if (accumulatedDepreciation.lt(0)) accumulatedDepreciation = new Prisma.Decimal(0);

    const netBookValue = cost.minus(accumulatedDepreciation); // GL carrying value
    const proceeds = opts.proceeds;
    // Positive => gain (proceeds exceed NBV); negative => loss.
    const gainLoss = proceeds.minus(netBookValue);
    const description = `Dispose fixed asset ${asset.assetCode} - ${asset.name}`;

    // Resolve gain/loss defensively: these roles are not part of the shared
    // AccountResolver role map yet, so resolve() will throw a clear BadRequest
    // if the chart isn't configured, rather than posting to a wrong account.
    const lines: Array<{ accountId: string; description: string; debit: Prisma.Decimal | number; credit: Prisma.Decimal | number }> = [];

    const assetAccount = await this.accountResolver.resolve(asset.companyId, 'FIXED_ASSET', tx);
    // CR Fixed Asset for full cost — reverse the capitalize debit.
    lines.push({ accountId: assetAccount.id, description, debit: 0, credit: cost });

    if (accumulatedDepreciation.gt(0)) {
      const accumulatedAccount = await this.accountResolver.resolve(
        asset.companyId,
        'ACCUMULATED_DEPRECIATION',
        tx,
      );
      // DR Accumulated Depreciation — remove the contra-asset balance.
      lines.push({
        accountId: accumulatedAccount.id,
        description,
        debit: accumulatedDepreciation,
        credit: 0,
      });
    }

    if (proceeds.gt(0)) {
      const cashAccount = await this.accountResolver.resolve(asset.companyId, 'CASH_ON_HAND', tx);
      // DR Cash for the disposal proceeds.
      lines.push({
        accountId: cashAccount.id,
        description: `Disposal proceeds: ${asset.assetCode}`,
        debit: proceeds,
        credit: 0,
      });
    }

    if (gainLoss.gt(0)) {
      const gainAccount = await this.accountResolver.resolve(
        asset.companyId,
        'GAIN_ON_DISPOSAL' as AccountRole,
        tx,
      );
      // CR Gain on disposal — balancing credit.
      lines.push({
        accountId: gainAccount.id,
        description: `Gain on disposal: ${asset.assetCode}`,
        debit: 0,
        credit: gainLoss,
      });
    } else if (gainLoss.lt(0)) {
      const lossAccount = await this.accountResolver.resolve(
        asset.companyId,
        'LOSS_ON_DISPOSAL' as AccountRole,
        tx,
      );
      // DR Loss on disposal — balancing debit (absolute value).
      lines.push({
        accountId: lossAccount.id,
        description: `Loss on disposal: ${asset.assetCode}`,
        debit: gainLoss.abs(),
        credit: 0,
      });
    }

    return this.postingEngine.postLines(
      {
        companyId: asset.companyId,
        divisionId: asset.divisionId,
        branchId: asset.branchId,
        transactionDate: opts.disposalDate,
        description,
        referenceType: 'FixedAssetDisposal',
        referenceId: asset.id,
        moduleName: 'fixed_assets',
        userId: opts.userId,
        lines,
      },
      tx,
    );
  }

  async markCollateral(id: string, dto: MarkCollateralDto, user: AuthUser) {
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;
    const updated = await this.prisma.fixedAsset.update({
      where: { id },
      data: {
        collateralStatus: dto.collateralStatus,
        ...(dto.notes && { notes: dto.notes }),
      },
      include: ASSET_INCLUDES,
    });

    await this.audit.log({
      action: 'fixed_asset.collateral_change',
      entityType: 'FixedAsset',
      entityId: id,
      userId,
      companyId: existing.companyId ?? undefined,
      oldValue: { collateralStatus: existing.collateralStatus },
      newValue: { collateralStatus: dto.collateralStatus },
    });

    return updated;
  }

  async capitalize(id: string, dto: CapitalizeFixedAssetDto, user: AuthUser) {
    const existing = await this.findOne(id);
    if (!existing.companyId) {
      throw new BadRequestException('Only company-owned assets can be capitalized into the GL');
    }
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);

    const existingJournal = await this.prisma.journalEntry.findFirst({
      where: {
        companyId: existing.companyId,
        referenceType: 'FixedAsset',
        referenceId: existing.id,
        deletedAt: null,
        status: { in: ['DRAFT', 'POSTED'] },
      },
      select: { id: true, journalNumber: true },
    });
    if (existingJournal) {
      throw new BadRequestException(
        `Fixed asset is already capitalized by journal entry ${existingJournal.journalNumber}`,
      );
    }

    const amount = new Prisma.Decimal(existing.acquisitionCost).toDecimalPlaces(2);
    if (amount.lte(0)) {
      throw new BadRequestException('Fixed asset acquisition cost must be greater than zero');
    }

    const source = dto.source ?? this.defaultCapitalizationSource(existing.financingStatus);
    const transactionDate = dto.transactionDate
      ? new Date(dto.transactionDate)
      : existing.acquisitionDate;
    const creditRole =
      source === FixedAssetCapitalizationSource.PAYABLE ? 'AP_CONTROL' : 'CASH_ON_HAND';
    const description = `Capitalize fixed asset ${existing.assetCode} - ${existing.name}`;

    const journalEntry = await this.prisma.$transaction(async (tx) => {
      const [assetAccount, creditAccount] = await Promise.all([
        this.accountResolver.resolve(existing.companyId!, 'FIXED_ASSET', tx),
        this.accountResolver.resolve(existing.companyId!, creditRole, tx),
      ]);

      return this.postingEngine.postLines(
        {
          companyId: existing.companyId!,
          divisionId: existing.divisionId,
          branchId: existing.branchId,
          transactionDate,
          description,
          referenceType: 'FixedAsset',
          referenceId: existing.id,
          moduleName: 'fixed_assets',
          userId: user.id,
          lines: [
            {
              accountId: assetAccount.id,
              description,
              debit: amount,
              credit: 0,
            },
            {
              accountId: creditAccount.id,
              description:
                source === FixedAssetCapitalizationSource.PAYABLE
                  ? `Asset payable: ${existing.assetCode}`
                  : `Asset cash acquisition: ${existing.assetCode}`,
              debit: 0,
              credit: amount,
            },
          ],
        },
        tx,
      );
    });

    await this.audit.log({
      action: 'fixed_asset.capitalize',
      entityType: 'FixedAsset',
      entityId: existing.id,
      userId: user.id,
      companyId: existing.companyId,
      metadata: { source, amount: amount.toString(), journalEntryId: journalEntry.id },
    });

    return { asset: existing, journalEntry };
  }

  private defaultCapitalizationSource(
    financingStatus: AssetFinancingStatus | null,
  ): FixedAssetCapitalizationSource {
    return financingStatus && financingStatus !== AssetFinancingStatus.OWNED_OUTRIGHT
      ? FixedAssetCapitalizationSource.PAYABLE
      : FixedAssetCapitalizationSource.CASH;
  }

  /** Aggregate summary across all assets, optionally filtered by company. */
  async getSummary(user: AuthUser, companyId?: string) {
    const baseWhere: Prisma.FixedAssetWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      baseWhere.companyId = companyId;
    } else {
      const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
      if (accessibleIds !== null) baseWhere.companyId = { in: accessibleIds };
    }

    const [
      totalCount,
      activeCount,
      collateralCount,
      uninsuredCount,
      disposedCount,
      underMaintenanceCount,
      valueTotals,
      byCategory,
      byCompany,
    ] = await Promise.all([
      this.prisma.fixedAsset.count({ where: baseWhere }),
      this.prisma.fixedAsset.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      this.prisma.fixedAsset.count({
        where: { ...baseWhere, collateralStatus: 'USED_AS_COLLATERAL' },
      }),
      this.prisma.fixedAsset.count({ where: { ...baseWhere, insuranceStatus: 'NOT_INSURED' } }),
      this.prisma.fixedAsset.count({
        where: { ...baseWhere, status: { in: ['DISPOSED', 'SOLD', 'WRITTEN_OFF'] } },
      }),
      this.prisma.fixedAsset.count({ where: { ...baseWhere, status: 'UNDER_MAINTENANCE' } }),
      this.prisma.fixedAsset.aggregate({
        where: baseWhere,
        _sum: { acquisitionCost: true, currentBookValue: true },
      }),
      this.prisma.fixedAsset.groupBy({
        by: ['category'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { currentBookValue: true },
        orderBy: { _count: { category: 'desc' } },
      }),
      this.prisma.fixedAsset.groupBy({
        by: ['companyId'],
        where: { ...baseWhere, companyId: { not: null } },
        _count: { _all: true },
        _sum: { acquisitionCost: true, currentBookValue: true },
      }),
    ]);

    const companyIds = byCompany.map((r) => r.companyId).filter(Boolean) as string[];
    const companies = await this.prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true, code: true },
    });
    const companyMap = new Map(companies.map((c) => [c.id, c]));

    return {
      totalCount,
      activeCount,
      collateralCount,
      uninsuredCount,
      disposedCount,
      underMaintenanceCount,
      totalAcquisitionCost: valueTotals._sum.acquisitionCost ?? 0,
      totalBookValue: valueTotals._sum.currentBookValue ?? 0,
      byCategory: byCategory.map((r) => ({
        category: r.category,
        count: r._count._all,
        bookValue: r._sum.currentBookValue ?? 0,
      })),
      byCompany: byCompany.map((r) => ({
        company: r.companyId ? companyMap.get(r.companyId) : null,
        count: r._count._all,
        acquisitionCost: r._sum.acquisitionCost ?? 0,
        bookValue: r._sum.currentBookValue ?? 0,
      })),
    };
  }

  async getAuditHistory(assetId: string, user: AuthUser) {
    await this.findOne(assetId, user);
    return this.prisma.auditLog.findMany({
      where: { entityType: 'FixedAsset', entityId: assetId },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
