import { Injectable, NotFoundException } from '@nestjs/common';
import { FuelPriceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateFuelPriceDto } from './dto/create-fuel-price.dto';
import { UpdateFuelPriceDto } from './dto/update-fuel-price.dto';

@Injectable()
export class FuelPricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: Record<string, unknown>) {
    const page = parseInt(query.page as string) || 1;
    const limit = parseInt(query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.companyId) where.companyId = query.companyId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.productId) where.productId = query.productId;
    if (query.status) where.status = query.status;

    const include = {
      branch: { select: { id: true, name: true, code: true, location: true } },
      product: { select: { id: true, name: true, productCode: true } },
    };

    const [data, total] = await Promise.all([
      this.prisma.fuelPrice.findMany({
        where,
        include,
        skip,
        take: limit,
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.prisma.fuelPrice.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.fuelPrice.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true, code: true, location: true } },
        product: { select: { id: true, name: true, productCode: true } },
      },
    });
    if (!record) throw new NotFoundException('Fuel price not found');
    return record;
  }

  async findCurrent(query: { companyId?: string; branchId?: string; productId?: string }) {
    const now = new Date();
    const where: Record<string, unknown> = {
      status: FuelPriceStatus.ACTIVE,
      effectiveFrom: { lte: now },
    };
    if (query.companyId) where.companyId = query.companyId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.productId) where.productId = query.productId;

    return this.prisma.fuelPrice.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true, code: true, location: true } },
        product: { select: { id: true, name: true, productCode: true } },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async create(dto: CreateFuelPriceDto, userId: string) {
    const status = dto.status ?? FuelPriceStatus.ACTIVE;

    // If creating an ACTIVE price, expire existing ACTIVE prices for same combination
    if (status === FuelPriceStatus.ACTIVE) {
      await this.prisma.fuelPrice.updateMany({
        where: {
          companyId: dto.companyId,
          branchId: dto.branchId ?? null,
          productId: dto.productId,
          status: FuelPriceStatus.ACTIVE,
        },
        data: {
          status: FuelPriceStatus.EXPIRED,
          effectiveTo: new Date(),
        },
      });
    }

    const record = await this.prisma.fuelPrice.create({
      data: {
        companyId: dto.companyId,
        branchId: dto.branchId,
        productId: dto.productId,
        pricePerLitre: dto.pricePerLitre,
        currency: dto.currency,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        status,
        notes: dto.notes,
        createdById: userId,
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_PRICE_CREATE',
      entityType: 'FuelPrice',
      entityId: record.id,
      userId,
      companyId: dto.companyId,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  async update(id: string, dto: UpdateFuelPriceDto, userId: string) {
    const existing = await this.findOne(id);

    const record = await this.prisma.fuelPrice.update({
      where: { id },
      data: {
        ...(dto.companyId !== undefined && { companyId: dto.companyId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.productId !== undefined && { productId: dto.productId }),
        ...(dto.pricePerLitre !== undefined && { pricePerLitre: dto.pricePerLitre }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.effectiveFrom !== undefined && { effectiveFrom: new Date(dto.effectiveFrom) }),
        ...(dto.effectiveTo !== undefined && {
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_PRICE_UPDATE',
      entityType: 'FuelPrice',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  async approve(id: string, userId: string) {
    const existing = await this.findOne(id);

    const record = await this.prisma.fuelPrice.update({
      where: { id },
      data: {
        approvedById: userId,
        approvedAt: new Date(),
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_PRICE_APPROVE',
      entityType: 'FuelPrice',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  async deactivate(id: string, userId: string) {
    const existing = await this.findOne(id);

    const record = await this.prisma.fuelPrice.update({
      where: { id },
      data: { status: FuelPriceStatus.INACTIVE },
    });

    await this.auditLogs.log({
      action: 'FUEL_PRICE_DEACTIVATE',
      entityType: 'FuelPrice',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as unknown as Record<string, unknown>,
      newValue: { status: FuelPriceStatus.INACTIVE } as unknown as Record<string, unknown>,
    });

    return record;
  }
}
