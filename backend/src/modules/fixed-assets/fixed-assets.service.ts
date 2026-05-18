import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccessLevel, AssetOwnershipLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { QueryFixedAssetDto } from './dto/query-fixed-asset.dto';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { MarkCollateralDto } from './dto/mark-collateral.dto';

const ASSET_INCLUDES = {
  company: { select: { id: true, name: true, code: true } },
  group: { select: { id: true, name: true, code: true } },
  division: { select: { id: true, name: true, code: true } },
  branch: { select: { id: true, name: true } },
};

@Injectable()
export class FixedAssetsService {
  private readonly logger = new Logger(FixedAssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
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
      skipCapitalization,
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
    const cost = new Prisma.Decimal(acquisitionCost);

    // Phase 2 — wrap create + capitalization JE in a single transaction so a
    // failed posting rolls the asset back too.
    const asset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.fixedAsset.create({
        data: {
          ...rest,
          acquisitionCost: cost,
          currentBookValue: new Prisma.Decimal(currentBookValue),
          acquisitionDate: new Date(acquisitionDate),
          ...(depreciationRate && { depreciationRate: new Prisma.Decimal(depreciationRate) }),
          ...(residualValue && { residualValue: new Prisma.Decimal(residualValue) }),
          createdById,
        },
        include: ASSET_INCLUDES,
      });

      // Capitalize: DR Fixed Asset / CR Cash. Skipped for historical-data imports
      // (skipCapitalization=true) or for group-level assets without a companyId
      // (no company context to anchor the journal entry against).
      if (!skipCapitalization && created.companyId && cost.gt(0)) {
        const [fixedAssetAccount, cashAccount] = await Promise.all([
          this.accountResolver.resolve(created.companyId, 'FIXED_ASSET_COST', tx),
          this.accountResolver.resolve(created.companyId, 'CASH_ON_HAND', tx),
        ]);

        await this.postingEngine.postLines(
          {
            companyId: created.companyId,
            divisionId: created.divisionId ?? undefined,
            branchId: created.branchId ?? undefined,
            transactionDate: new Date(acquisitionDate),
            description: `Capitalization — ${created.name} (${created.assetCode})`,
            referenceType: 'FixedAsset',
            referenceId: created.id,
            moduleName: 'fixed-assets',
            userId: createdById,
            lines: [
              {
                accountId: fixedAssetAccount.id,
                debit: cost,
                description: `Acquisition cost — ${created.name}`,
              },
              {
                accountId: cashAccount.id,
                credit: cost,
                description: `Payment for ${created.assetCode}`,
              },
            ],
          },
          tx,
        );
      }

      return created;
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
    const updated = await this.prisma.fixedAsset.update({
      where: { id },
      data: {
        status: dto.disposalStatus,
        disposalDate: new Date(dto.disposalDate),
        ...(dto.disposalValue && { disposalValue: new Prisma.Decimal(dto.disposalValue) }),
        ...(dto.notes && { notes: dto.notes }),
      },
      include: ASSET_INCLUDES,
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
        disposalValue: dto.disposalValue,
      },
    });

    return updated;
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
