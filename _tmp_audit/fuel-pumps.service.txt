import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FuelPumpStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateFuelPumpDto } from './dto/create-fuel-pump.dto';
import { UpdateFuelPumpDto } from './dto/update-fuel-pump.dto';

@Injectable()
export class FuelPumpsService {
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
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.fuelPump.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.fuelPump.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.fuelPump.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Fuel pump not found');
    return record;
  }

  async findByBranch(branchId: string) {
    return this.prisma.fuelPump.findMany({
      where: { branchId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateFuelPumpDto, userId: string) {
    const duplicate = await this.prisma.fuelPump.findFirst({
      where: { pumpCode: dto.pumpCode, branchId: dto.branchId, deletedAt: null },
    });
    if (duplicate) throw new BadRequestException('Pump code already exists for this branch');

    const record = await this.prisma.fuelPump.create({
      data: {
        pumpCode: dto.pumpCode,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        pumpName: dto.pumpName,
        status: dto.status ?? FuelPumpStatus.ACTIVE,
        installationDate: dto.installationDate ? new Date(dto.installationDate) : undefined,
        notes: dto.notes,
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_PUMP_CREATE',
      entityType: 'FuelPump',
      entityId: record.id,
      userId,
      companyId: dto.companyId,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  async update(id: string, dto: UpdateFuelPumpDto, userId: string) {
    const existing = await this.findOne(id);

    if (dto.pumpCode && dto.pumpCode !== existing.pumpCode) {
      const targetBranch = dto.branchId ?? existing.branchId;
      const duplicate = await this.prisma.fuelPump.findFirst({
        where: { pumpCode: dto.pumpCode, branchId: targetBranch, deletedAt: null, NOT: { id } },
      });
      if (duplicate) throw new BadRequestException('Pump code already exists for this branch');
    }

    const record = await this.prisma.fuelPump.update({
      where: { id },
      data: {
        ...(dto.pumpCode !== undefined && { pumpCode: dto.pumpCode }),
        ...(dto.pumpName !== undefined && { pumpName: dto.pumpName }),
        ...(dto.companyId !== undefined && { companyId: dto.companyId }),
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.installationDate !== undefined && {
          installationDate: dto.installationDate ? new Date(dto.installationDate) : null,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_PUMP_UPDATE',
      entityType: 'FuelPump',
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
    await this.prisma.fuelPump.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'FUEL_PUMP_DELETE',
      entityType: 'FuelPump',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
    });

    return { success: true };
  }
}
