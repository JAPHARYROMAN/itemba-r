import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FuelTankDipStatus,
  FuelPriceStatus,
  InventoryMovementType,
  AccessLevel,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { CreateFuelTankDipDto } from './dto/create-fuel-tank-dip.dto';
import { UpdateFuelTankDipDto } from './dto/update-fuel-tank-dip.dto';

@Injectable()
export class FuelTankDipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: Record<string, unknown>, user: AuthUser) {
    const page = parseInt(query.page as string) || 1;
    const limit = parseInt(query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId as string | undefined)),
    };
    if (query.branchId) where.branchId = query.branchId;
    if (query.tankId) where.tankId = query.tankId;
    if (query.productId) where.productId = query.productId;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.fuelTankDip.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          tank: true,
          product: true,
          measuredBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.fuelTankDip.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.fuelTankDip.findFirst({
      where: { id, deletedAt: null },
      include: {
        tank: true,
        product: true,
        measuredBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!record) throw new NotFoundException('Fuel tank dip not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async create(dto: CreateFuelTankDipDto, user: AuthUser) {
    const userId = user.id;
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    const tank = await this.prisma.fuelTank.findFirst({
      where: { id: dto.tankId, deletedAt: null },
    });
    if (!tank) throw new NotFoundException('Fuel tank not found');

    const activePrice = await this.prisma.fuelPrice.findFirst({
      where: {
        companyId: dto.companyId,
        productId: dto.productId,
        status: FuelPriceStatus.ACTIVE,
        effectiveFrom: { lte: new Date() },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    const bookBalance = Number(tank.currentBookBalance ?? 0);
    const varianceLitres = dto.physicalDipLitres - bookBalance;
    const varianceValue = activePrice
      ? varianceLitres * Number(activePrice.pricePerLitre)
      : undefined;

    const dipNumber = await this.codes.next({
      entityType: 'FuelTankDip',
      companyId: dto.companyId,
    });

    const record = await this.prisma.fuelTankDip.create({
      data: {
        dipNumber,
        companyId: dto.companyId,
        branchId: dto.branchId,
        tankId: dto.tankId,
        productId: dto.productId,
        dipDate: new Date(dto.dipDate),
        dipTime: new Date(dto.dipTime),
        bookBalance,
        physicalDipLitres: dto.physicalDipLitres,
        varianceLitres,
        varianceValue,
        measuredById: userId,
        status: FuelTankDipStatus.DRAFT,
        notes: dto.notes,
      },
    });

    await this.auditLogs.log({
      action: 'TANK_DIP_CREATE',
      entityType: 'FuelTankDip',
      entityId: record.id,
      userId,
      companyId: dto.companyId,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  async update(id: string, dto: UpdateFuelTankDipDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== FuelTankDipStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT dips can be updated');
    }

    let bookBalance = Number(existing.bookBalance);
    let varianceLitres = Number(existing.varianceLitres);
    let varianceValue: number | null =
      existing.varianceValue != null ? Number(existing.varianceValue) : null;

    if (dto.tankId || dto.physicalDipLitres !== undefined) {
      const tankId = dto.tankId ?? existing.tankId;
      const tank = await this.prisma.fuelTank.findFirst({ where: { id: tankId, deletedAt: null } });
      if (!tank) throw new NotFoundException('Fuel tank not found');
      bookBalance = Number(tank.currentBookBalance ?? 0);
      const physicalDip = dto.physicalDipLitres ?? Number(existing.physicalDipLitres);
      varianceLitres = physicalDip - bookBalance;

      const companyId = dto.companyId ?? existing.companyId;
      const productId = dto.productId ?? existing.productId;
      const activePrice = await this.prisma.fuelPrice.findFirst({
        where: {
          companyId,
          productId,
          status: FuelPriceStatus.ACTIVE,
          effectiveFrom: { lte: new Date() },
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      varianceValue = activePrice ? varianceLitres * Number(activePrice.pricePerLitre) : null;
    }

    const record = await this.prisma.fuelTankDip.update({
      where: { id },
      data: {
        ...(dto.tankId !== undefined && { tankId: dto.tankId }),
        ...(dto.productId !== undefined && { productId: dto.productId }),
        ...(dto.dipDate !== undefined && { dipDate: new Date(dto.dipDate) }),
        ...(dto.dipTime !== undefined && { dipTime: new Date(dto.dipTime) }),
        ...(dto.physicalDipLitres !== undefined && { physicalDipLitres: dto.physicalDipLitres }),
        bookBalance,
        varianceLitres,
        varianceValue,
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    await this.auditLogs.log({
      action: 'TANK_DIP_UPDATE',
      entityType: 'FuelTankDip',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: record as unknown as Record<string, unknown>,
    });

    return record;
  }

  async submit(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== FuelTankDipStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT dips can be submitted');
    }

    const record = await this.prisma.fuelTankDip.update({
      where: { id },
      data: { status: FuelTankDipStatus.SUBMITTED },
    });

    await this.auditLogs.log({
      action: 'TANK_DIP_SUBMIT',
      entityType: 'FuelTankDip',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: FuelTankDipStatus.DRAFT },
      newValue: { status: FuelTankDipStatus.SUBMITTED },
    });

    return record;
  }

  async approve(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== FuelTankDipStatus.SUBMITTED) {
      throw new BadRequestException('Only SUBMITTED dips can be approved');
    }

    const record = await this.prisma.fuelTankDip.update({
      where: { id },
      data: {
        status: FuelTankDipStatus.APPROVED,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });

    await this.auditLogs.log({
      action: 'TANK_DIP_APPROVE',
      entityType: 'FuelTankDip',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: FuelTankDipStatus.SUBMITTED },
      newValue: { status: FuelTankDipStatus.APPROVED },
    });

    return record;
  }

  async reject(id: string, user: AuthUser, reason: string) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (
      existing.status !== FuelTankDipStatus.SUBMITTED &&
      existing.status !== FuelTankDipStatus.APPROVED
    ) {
      throw new BadRequestException('Only SUBMITTED or APPROVED dips can be rejected');
    }

    const notes = reason
      ? `[REJECTED] ${reason}${existing.notes ? `\n${existing.notes}` : ''}`
      : (existing.notes ?? undefined);

    const record = await this.prisma.fuelTankDip.update({
      where: { id },
      data: {
        status: FuelTankDipStatus.REJECTED,
        notes,
      },
    });

    await this.auditLogs.log({
      action: 'TANK_DIP_REJECT',
      entityType: 'FuelTankDip',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status },
      newValue: { status: FuelTankDipStatus.REJECTED, reason },
    });

    return record;
  }

  async post(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== FuelTankDipStatus.APPROVED) {
      throw new BadRequestException('Only APPROVED dips can be posted');
    }

    const tank = await this.prisma.fuelTank.findFirst({
      where: { id: existing.tankId, deletedAt: null },
    });
    if (!tank) throw new NotFoundException('Fuel tank not found');

    const physicalDip = Number(existing.physicalDipLitres);
    const varianceLitres = Number(existing.varianceLitres);

    await this.prisma.fuelTank.update({
      where: { id: tank.id },
      data: {
        lastDipBalance: physicalDip,
        currentBookBalance: physicalDip,
      },
    });

    if (varianceLitres !== 0) {
      const activePrice = await this.prisma.fuelPrice.findFirst({
        where: {
          companyId: existing.companyId,
          productId: existing.productId,
          status: FuelPriceStatus.ACTIVE,
          effectiveFrom: { lte: new Date() },
        },
        orderBy: { effectiveFrom: 'desc' },
      });

      const product = await this.prisma.product.findUnique({
        where: { id: existing.productId },
        select: { baseUnitId: true },
      });

      await this.inventoryMovements.createMovement({
        companyId: existing.companyId,
        branchId: existing.branchId,
        productId: existing.productId,
        movementType:
          varianceLitres > 0
            ? InventoryMovementType.ADJUSTMENT_IN
            : InventoryMovementType.ADJUSTMENT_OUT,
        quantity: Math.abs(varianceLitres),
        unitId: product?.baseUnitId ?? '',
        unitCost: activePrice ? Number(activePrice.pricePerLitre) : undefined,
        movementDate: new Date(),
        referenceType: 'FUEL_TANK_DIP',
        referenceId: existing.id,
        notes: `Tank dip variance: ${varianceLitres}L`,
        createdById: userId,
      });
    }

    const record = await this.prisma.fuelTankDip.update({
      where: { id },
      data: { status: FuelTankDipStatus.POSTED },
    });

    await this.auditLogs.log({
      action: 'TANK_DIP_POST',
      entityType: 'FuelTankDip',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: FuelTankDipStatus.APPROVED },
      newValue: { status: FuelTankDipStatus.POSTED },
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
      throw new BadRequestException('Only DRAFT or REJECTED dips can be deleted');
    }

    await this.prisma.fuelTankDip.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'TANK_DIP_DELETE',
      entityType: 'FuelTankDip',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
    });

    return { success: true };
  }
}
