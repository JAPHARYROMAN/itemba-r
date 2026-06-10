import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FuelNozzleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateFuelNozzleDto } from './dto/create-fuel-nozzle.dto';
import { UpdateFuelNozzleDto } from './dto/update-fuel-nozzle.dto';

@Injectable()
export class FuelNozzlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: Record<string, unknown>) {
    const page = parseInt(query.page as string) || 1;
    const limit = parseInt(query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.companyId) where.companyId = query.companyId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.pumpId) where.pumpId = query.pumpId;
    if (query.tankId) where.tankId = query.tankId;
    if (query.productId) where.productId = query.productId;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.fuelNozzle.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.fuelNozzle.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.fuelNozzle.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Fuel nozzle not found');
    return record;
  }

  async findByPump(pumpId: string) {
    return this.prisma.fuelNozzle.findMany({
      where: { pumpId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByBranch(branchId: string) {
    return this.prisma.fuelNozzle.findMany({
      where: { branchId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateFuelNozzleDto, userId: string) {
    // Validate that nozzle productId matches the tank's productId
    const tank = await this.prisma.fuelTank.findFirst({
      where: { id: dto.tankId, deletedAt: null },
    });
    if (!tank) throw new NotFoundException('Fuel tank not found');
    if (tank.productId !== dto.productId) {
      throw new BadRequestException(
        'Nozzle product must match the product assigned to the tank',
      );
    }

    const duplicate = await this.prisma.fuelNozzle.findFirst({
      where: { nozzleCode: dto.nozzleCode, pumpId: dto.pumpId, deletedAt: null },
    });
    if (duplicate) throw new BadRequestException('Nozzle code already exists for this pump');

    const record = await this.prisma.fuelNozzle.create({
      data: {
        nozzleCode: dto.nozzleCode,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        pumpId: dto.pumpId,
        tankId: dto.tankId,
        productId: dto.productId,
        nozzleName: dto.nozzleName,
        currentMeterReading: dto.currentMeterReading ?? 0,
        status: dto.status ?? FuelNozzleStatus.ACTIVE,
        notes: dto.notes,
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_NOZZLE_CREATE',
      entityType: 'FuelNozzle',
      entityId: record.id,
      userId,
      companyId: dto.companyId,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  async update(id: string, dto: UpdateFuelNozzleDto, userId: string) {
    const existing = await this.findOne(id);

    // If tankId or productId changes, re-validate product match
    const tankId = dto.tankId ?? existing.tankId;
    const productId = dto.productId ?? existing.productId;
    if (dto.tankId || dto.productId) {
      const tank = await this.prisma.fuelTank.findFirst({
        where: { id: tankId, deletedAt: null },
      });
      if (!tank) throw new NotFoundException('Fuel tank not found');
      if (tank.productId !== productId) {
        throw new BadRequestException(
          'Nozzle product must match the product assigned to the tank',
        );
      }
    }

    const record = await this.prisma.fuelNozzle.update({
      where: { id },
      data: {
        ...(dto.nozzleCode !== undefined && { nozzleCode: dto.nozzleCode }),
        ...(dto.nozzleName !== undefined && { nozzleName: dto.nozzleName }),
        ...(dto.companyId !== undefined && { companyId: dto.companyId }),
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.pumpId !== undefined && { pumpId: dto.pumpId }),
        ...(dto.tankId !== undefined && { tankId: dto.tankId }),
        ...(dto.productId !== undefined && { productId: dto.productId }),
        ...(dto.currentMeterReading !== undefined && { currentMeterReading: dto.currentMeterReading }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_NOZZLE_UPDATE',
      entityType: 'FuelNozzle',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.fuelNozzle.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'FUEL_NOZZLE_DELETE',
      entityType: 'FuelNozzle',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
    });

    return { success: true };
  }
}
