import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { QueryUnitDto } from './dto/query-unit.dto';
import { CreateUnitConversionDto } from './dto/create-unit-conversion.dto';
import { UpdateUnitConversionDto } from './dto/update-unit-conversion.dto';
import { AuditSeverity } from '@prisma/client';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ─── Units ───────────────────────────────────────────────────────────────

  async findAllUnits(query: QueryUnitDto) {
    const { page = 1, limit = 20, companyId, status, unitType, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (unitType) where.unitType = unitType;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { symbol: { contains: search, mode: 'insensitive' } },
      ];
    }

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

  async findOneUnit(id: string) {
    const record = await this.prisma.unitOfMeasure.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Unit of measure not found');
    return record;
  }

  async createUnit(dto: CreateUnitDto, userId: string) {
    const where: any = { deletedAt: null };
    if (dto.companyId) where.companyId = dto.companyId;
    else where.companyId = null;

    const existing = await this.prisma.unitOfMeasure.findFirst({
      where: { ...where, OR: [{ name: dto.name }, { symbol: dto.symbol }] },
    });
    if (existing) {
      throw new BadRequestException(
        'A unit with this name or symbol already exists',
      );
    }

    const record = await this.prisma.unitOfMeasure.create({
      data: {
        companyId: dto.companyId ?? null,
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
      userId,
      companyId: record.companyId ?? undefined,
      newValue: record as any,
    });

    return record;
  }

  async updateUnit(id: string, dto: UpdateUnitDto, userId: string) {
    const existing = await this.findOneUnit(id);
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
      userId,
      companyId: record.companyId ?? undefined,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async removeUnit(id: string, userId: string) {
    const existing = await this.findOneUnit(id);
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
      userId,
      companyId: existing.companyId ?? undefined,
      oldValue: existing as any,
      severity: AuditSeverity.HIGH,
    });

    return { success: true };
  }

  // ─── Unit Conversions ────────────────────────────────────────────────────

  async findAllConversions(query: QueryUnitDto) {
    const { page = 1, limit = 20, companyId } = query;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;

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

  async findOneConversion(id: string) {
    const record = await this.prisma.unitConversion.findFirst({
      where: { id, deletedAt: null },
      include: {
        fromUnit: { select: { id: true, name: true, symbol: true } },
        toUnit: { select: { id: true, name: true, symbol: true } },
      },
    });
    if (!record) throw new NotFoundException('Unit conversion not found');
    return record;
  }

  async createConversion(dto: CreateUnitConversionDto, userId: string) {
    if (dto.fromUnitId === dto.toUnitId) {
      throw new BadRequestException(
        'fromUnitId and toUnitId must be different',
      );
    }

    const existing = await this.prisma.unitConversion.findFirst({
      where: {
        deletedAt: null,
        fromUnitId: dto.fromUnitId,
        toUnitId: dto.toUnitId,
        companyId: dto.companyId ?? null,
      },
    });
    if (existing) {
      throw new BadRequestException(
        'A conversion between these units already exists',
      );
    }

    const record = await this.prisma.unitConversion.create({
      data: {
        companyId: dto.companyId ?? null,
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
      userId,
      companyId: record.companyId ?? undefined,
      newValue: record as any,
    });

    return record;
  }

  async updateConversion(
    id: string,
    dto: UpdateUnitConversionDto,
    userId: string,
  ) {
    const existing = await this.findOneConversion(id);

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
      userId,
      companyId: record.companyId ?? undefined,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async removeConversion(id: string, userId: string) {
    const existing = await this.findOneConversion(id);

    await this.prisma.unitConversion.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'UNIT_CONVERSION_DELETE',
      entityType: 'UnitConversion',
      entityId: id,
      userId,
      companyId: existing.companyId ?? undefined,
      oldValue: existing as any,
      severity: AuditSeverity.HIGH,
    });

    return { success: true };
  }
}
