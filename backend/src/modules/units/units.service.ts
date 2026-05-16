import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { QueryUnitDto } from './dto/query-unit.dto';
import { CreateUnitConversionDto } from './dto/create-unit-conversion.dto';
import { UpdateUnitConversionDto } from './dto/update-unit-conversion.dto';
import { AccessLevel, AuditSeverity, Prisma } from '@prisma/client';
import { CompanyScopeService } from '../../common/services';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  // ─── Units ───────────────────────────────────────────────────────────────

  async findAllUnits(query: QueryUnitDto, user?: any) {
    const { page = 1, limit = 20, companyId, status, unitType, search } = query;
    const skip = (page - 1) * limit;

    const and: Prisma.UnitOfMeasureWhereInput[] = [
      await this.companyOrSystemUnitWhere(user, companyId),
    ];
    if (search) {
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { symbol: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.UnitOfMeasureWhereInput = {
      deletedAt: null,
      AND: and,
      ...(status && { status }),
      ...(unitType && { unitType }),
    };

    const [data, total] = await Promise.all([
      this.prisma.unitOfMeasure.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.unitOfMeasure.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneUnit(id: string, user: AuthUser, minimumAccess: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.unitOfMeasure.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Unit of measure not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimumAccess);
    return record;
  }

  async createUnit(dto: CreateUnitDto, user: AuthUser) {
    const companyId = await this.resolveWriteCompanyId(user, dto.companyId);
    const where: any = { deletedAt: null, companyId: companyId ?? null };

    const existing = await this.prisma.unitOfMeasure.findFirst({
      where: { ...where, OR: [{ name: dto.name }, { symbol: dto.symbol }] },
    });
    if (existing) {
      throw new BadRequestException('A unit with this name or symbol already exists');
    }

    const record = await this.prisma.unitOfMeasure.create({
      data: {
        companyId,
        name: dto.name,
        symbol: dto.symbol,
        unitType: dto.unitType,
        isBaseUnit: dto.isBaseUnit ?? false,
        isSystemUnit: false,
        status: dto.status ?? 'ACTIVE',
      },
    });

    await this.auditLogs.log({
      action: 'UNIT_CREATE',
      entityType: 'UnitOfMeasure',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      newValue: record as any,
    });

    return record;
  }

  async updateUnit(id: string, dto: UpdateUnitDto, user: AuthUser) {
    const existing = await this.findOneUnit(id, user, AccessLevel.WRITE);
    if (existing.isSystemUnit) {
      throw new BadRequestException('System units cannot be modified');
    }

    const record = await this.prisma.unitOfMeasure.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.symbol !== undefined && { symbol: dto.symbol }),
        ...(dto.unitType !== undefined && { unitType: dto.unitType }),
        ...(dto.isBaseUnit !== undefined && { isBaseUnit: dto.isBaseUnit }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    await this.auditLogs.log({
      action: 'UNIT_UPDATE',
      entityType: 'UnitOfMeasure',
      entityId: id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async removeUnit(id: string, user: AuthUser) {
    const existing = await this.findOneUnit(id, user, AccessLevel.WRITE);
    if (existing.isSystemUnit) {
      throw new BadRequestException('System units cannot be deleted');
    }

    await this.prisma.unitOfMeasure.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'UNIT_DELETE',
      entityType: 'UnitOfMeasure',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      oldValue: existing as any,
      severity: AuditSeverity.HIGH,
    });

    return { success: true };
  }

  // ─── Unit Conversions ────────────────────────────────────────────────────

  async findAllConversions(query: QueryUnitDto, user?: any) {
    const { page = 1, limit = 20, companyId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.UnitConversionWhereInput = {
      deletedAt: null,
      AND: [await this.companyOrSystemConversionWhere(user, companyId)],
    };

    const [data, total] = await Promise.all([
      this.prisma.unitConversion.findMany({
        where,
        include: {
          fromUnit: { select: { id: true, name: true, symbol: true } },
          toUnit: { select: { id: true, name: true, symbol: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.unitConversion.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneConversion(
    id: string,
    user: AuthUser,
    minimumAccess: AccessLevel = AccessLevel.READ,
  ) {
    const record = await this.prisma.unitConversion.findFirst({
      where: { id, deletedAt: null },
      include: {
        fromUnit: { select: { id: true, name: true, symbol: true } },
        toUnit: { select: { id: true, name: true, symbol: true } },
      },
    });
    if (!record) throw new NotFoundException('Unit conversion not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimumAccess);
    return record;
  }

  async createConversion(dto: CreateUnitConversionDto, user: AuthUser) {
    if (dto.fromUnitId === dto.toUnitId) {
      throw new BadRequestException('fromUnitId and toUnitId must be different');
    }
    const companyId = await this.resolveWriteCompanyId(user, dto.companyId);
    await this.assertUnitsUsableByCompany([dto.fromUnitId, dto.toUnitId], companyId);

    const existing = await this.prisma.unitConversion.findFirst({
      where: {
        deletedAt: null,
        fromUnitId: dto.fromUnitId,
        toUnitId: dto.toUnitId,
        companyId,
      },
    });
    if (existing) {
      throw new BadRequestException('A conversion between these units already exists');
    }

    const record = await this.prisma.unitConversion.create({
      data: {
        companyId,
        fromUnitId: dto.fromUnitId,
        toUnitId: dto.toUnitId,
        conversionFactor: dto.conversionFactor,
        description: dto.description,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogs.log({
      action: 'UNIT_CONVERSION_CREATE',
      entityType: 'UnitConversion',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      newValue: record as any,
    });

    return record;
  }

  async updateConversion(id: string, dto: UpdateUnitConversionDto, user: AuthUser) {
    const existing = await this.findOneConversion(id, user, AccessLevel.WRITE);

    const record = await this.prisma.unitConversion.update({
      where: { id },
      data: {
        ...(dto.conversionFactor !== undefined && {
          conversionFactor: dto.conversionFactor,
        }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogs.log({
      action: 'UNIT_CONVERSION_UPDATE',
      entityType: 'UnitConversion',
      entityId: id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async removeConversion(id: string, user: AuthUser) {
    const existing = await this.findOneConversion(id, user, AccessLevel.WRITE);

    await this.prisma.unitConversion.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'UNIT_CONVERSION_DELETE',
      entityType: 'UnitConversion',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      oldValue: existing as any,
      severity: AuditSeverity.HIGH,
    });

    return { success: true };
  }

  private async resolveWriteCompanyId(
    user: AuthUser,
    requestedCompanyId?: string,
  ): Promise<string | null> {
    if (requestedCompanyId) {
      await this.companyScope.assertCanAccessCompany(user, requestedCompanyId, AccessLevel.WRITE);
      return requestedCompanyId;
    }

    if (this.companyScope.isGroupScoped(user)) return null;

    const companyIds = await this.companyScope.accessibleCompanyIds(user);
    if (companyIds?.length === 1) return companyIds[0];

    throw new BadRequestException(
      'companyId is required when the user does not have exactly one accessible company',
    );
  }

  private async companyOrSystemUnitWhere(
    user: AuthUser,
    requestedCompanyId?: string,
  ): Promise<Prisma.UnitOfMeasureWhereInput> {
    if (requestedCompanyId) {
      await this.companyScope.assertCanAccessCompany(user, requestedCompanyId);
      return { OR: [{ companyId: requestedCompanyId }, { companyId: null }] };
    }

    const companyIds = await this.companyScope.accessibleCompanyIds(user);
    if (companyIds.length === 0) return { companyId: null };

    return { OR: [{ companyId: null }, { companyId: { in: companyIds } }] };
  }

  private async companyOrSystemConversionWhere(
    user: AuthUser,
    requestedCompanyId?: string,
  ): Promise<Prisma.UnitConversionWhereInput> {
    if (requestedCompanyId) {
      await this.companyScope.assertCanAccessCompany(user, requestedCompanyId);
      return { OR: [{ companyId: requestedCompanyId }, { companyId: null }] };
    }

    const companyIds = await this.companyScope.accessibleCompanyIds(user);
    if (companyIds.length === 0) return { companyId: null };

    return { OR: [{ companyId: null }, { companyId: { in: companyIds } }] };
  }

  private async assertUnitsUsableByCompany(unitIds: string[], companyId: string | null) {
    const uniqueIds = Array.from(new Set(unitIds));
    const units = await this.prisma.unitOfMeasure.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, companyId: true },
    });

    const validIds = new Set(
      units
        .filter((unit) =>
          companyId
            ? unit.companyId === null || unit.companyId === companyId
            : unit.companyId === null,
        )
        .map((unit) => unit.id),
    );

    if (validIds.size !== uniqueIds.length) {
      throw new BadRequestException('Unit conversion units must belong to the target company');
    }
  }
}
