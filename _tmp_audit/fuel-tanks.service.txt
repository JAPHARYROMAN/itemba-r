import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FuelTankStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateFuelTankDto } from './dto/create-fuel-tank.dto';
import { UpdateFuelTankDto } from './dto/update-fuel-tank.dto';

@Injectable()
export class FuelTanksService {
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
    if (query.productId) where.productId = query.productId;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.fuelTank.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.fuelTank.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.fuelTank.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Fuel tank not found');
    return record;
  }

  async findByBranch(branchId: string) {
    return this.prisma.fuelTank.findMany({
      where: { branchId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateFuelTankDto, userId: string) {
    const duplicate = await this.prisma.fuelTank.findFirst({
      where: { tankCode: dto.tankCode, branchId: dto.branchId, deletedAt: null },
    });
    if (duplicate) throw new BadRequestException('Tank code already exists for this branch');

    const record = await this.prisma.fuelTank.create({
      data: {
        tankCode: dto.tankCode,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        productId: dto.productId,
        tankName: dto.tankName,
        capacityLitres: dto.capacityLitres,
        status: dto.status ?? FuelTankStatus.ACTIVE,
        installationDate: dto.installationDate ? new Date(dto.installationDate) : undefined,
        notes: dto.notes,
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_TANK_CREATE',
      entityType: 'FuelTank',
      entityId: record.id,
      userId,
      companyId: dto.companyId,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  async update(id: string, dto: UpdateFuelTankDto, userId: string) {
    const existing = await this.findOne(id);

    if (dto.tankCode && dto.tankCode !== existing.tankCode) {
      const targetBranch = dto.branchId ?? existing.branchId;
      const duplicate = await this.prisma.fuelTank.findFirst({
        where: { tankCode: dto.tankCode, branchId: targetBranch, deletedAt: null, NOT: { id } },
      });
      if (duplicate) throw new BadRequestException('Tank code already exists for this branch');
    }

    const record = await this.prisma.fuelTank.update({
      where: { id },
      data: {
        ...(dto.tankCode !== undefined && { tankCode: dto.tankCode }),
        ...(dto.tankName !== undefined && { tankName: dto.tankName }),
        ...(dto.companyId !== undefined && { companyId: dto.companyId }),
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.productId !== undefined && { productId: dto.productId }),
        ...(dto.capacityLitres !== undefined && { capacityLitres: dto.capacityLitres }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.installationDate !== undefined && {
          installationDate: dto.installationDate ? new Date(dto.installationDate) : null,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_TANK_UPDATE',
      entityType: 'FuelTank',
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
    await this.prisma.fuelTank.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'FUEL_TANK_DELETE',
      entityType: 'FuelTank',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
    });

    return { success: true };
  }
}
