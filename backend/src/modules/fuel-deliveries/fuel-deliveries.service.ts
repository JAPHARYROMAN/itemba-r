import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryMovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateFuelDeliveryDto } from './dto/create-fuel-delivery.dto';
import { UpdateFuelDeliveryDto } from './dto/update-fuel-delivery.dto';

@Injectable()
export class FuelDeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  async create(dto: CreateFuelDeliveryDto, user: AuthUser) {
    const deliveryNumber = await this.codes.next({ entityType: 'FuelDelivery', companyId: dto.companyId });
    const totalCost =
      dto.totalCost ?? (dto.unitCost != null ? dto.acceptedLitres * dto.unitCost : undefined);

    const delivery = await this.prisma.fuelDelivery.create({
      data: {
        deliveryNumber,
        companyId: dto.companyId,
        branchId: dto.branchId,
        supplierId: dto.supplierId,
        productId: dto.productId,
        tankId: dto.tankId,
        purchaseOrderId: dto.purchaseOrderId,
        deliveryDate: new Date(dto.deliveryDate),
        deliveryNoteNumber: dto.deliveryNoteNumber,
        invoiceNumber: dto.invoiceNumber,
        orderedLitres: dto.orderedLitres,
        deliveredLitres: dto.deliveredLitres,
        acceptedLitres: dto.acceptedLitres,
        rejectedLitres: dto.rejectedLitres,
        unitCost: dto.unitCost,
        totalCost,
        driverName: dto.driverName,
        truckNumber: dto.truckNumber,
        notes: dto.notes,
        status: 'DRAFT',
        receivedById: user.id,
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_DELIVERY_CREATE',
      entityType: 'FuelDelivery',
      entityId: delivery.id,
      userId: user.id,
      companyId: dto.companyId,
      newValue: delivery as unknown as Record<string, unknown>,
    });

    return delivery;
  }

  async findAll(query: Record<string, string>) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.companyId) where.companyId = query.companyId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.fuelDelivery.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
          tank: { select: { id: true, tankName: true, tankCode: true } },
        },
      }),
      this.prisma.fuelDelivery.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const delivery = await this.prisma.fuelDelivery.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: true,
        product: true,
        tank: true,
      },
    });
    if (!delivery) throw new NotFoundException('Fuel delivery not found');
    return delivery;
  }

  async update(id: string, dto: UpdateFuelDeliveryDto, user: AuthUser) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT deliveries can be updated');
    }

    const acceptedLitres = dto.acceptedLitres ?? Number(existing.acceptedLitres);
    const unitCost = dto.unitCost ?? (existing.unitCost != null ? Number(existing.unitCost) : undefined);
    const totalCost = dto.totalCost ?? (unitCost != null ? acceptedLitres * unitCost : undefined);

    const updated = await this.prisma.fuelDelivery.update({
      where: { id },
      data: {
        ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
        ...(dto.productId !== undefined && { productId: dto.productId }),
        ...(dto.tankId !== undefined && { tankId: dto.tankId }),
        ...(dto.purchaseOrderId !== undefined && { purchaseOrderId: dto.purchaseOrderId }),
        ...(dto.deliveryDate !== undefined && { deliveryDate: new Date(dto.deliveryDate) }),
        ...(dto.deliveryNoteNumber !== undefined && { deliveryNoteNumber: dto.deliveryNoteNumber }),
        ...(dto.invoiceNumber !== undefined && { invoiceNumber: dto.invoiceNumber }),
        ...(dto.orderedLitres !== undefined && { orderedLitres: dto.orderedLitres }),
        ...(dto.deliveredLitres !== undefined && { deliveredLitres: dto.deliveredLitres }),
        ...(dto.acceptedLitres !== undefined && { acceptedLitres: dto.acceptedLitres }),
        ...(dto.rejectedLitres !== undefined && { rejectedLitres: dto.rejectedLitres }),
        ...(dto.unitCost !== undefined && { unitCost: dto.unitCost }),
        totalCost,
        ...(dto.driverName !== undefined && { driverName: dto.driverName }),
        ...(dto.truckNumber !== undefined && { truckNumber: dto.truckNumber }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    await this.auditLogs.log({
      action: 'FUEL_DELIVERY_UPDATE',
      entityType: 'FuelDelivery',
      entityId: id,
      userId: user.id,
      companyId: updated.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  async receive(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT deliveries can be received');
    }

    const updated = await this.prisma.fuelDelivery.update({
      where: { id },
      data: { status: 'RECEIVED', receivedById: user.id },
    });

    await this.auditLogs.log({
      action: 'FUEL_DELIVERY_RECEIVE',
      entityType: 'FuelDelivery',
      entityId: id,
      userId: user.id,
      companyId: updated.companyId,
      oldValue: { status: 'DRAFT' },
      newValue: { status: 'RECEIVED' },
    });

    return updated;
  }

  async approve(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    if (existing.status !== 'RECEIVED') {
      throw new BadRequestException('Only RECEIVED deliveries can be approved');
    }

    const updated = await this.prisma.fuelDelivery.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'FUEL_DELIVERY_APPROVE',
      entityType: 'FuelDelivery',
      entityId: id,
      userId: user.id,
      companyId: updated.companyId,
      oldValue: { status: 'RECEIVED' },
      newValue: { status: 'APPROVED' },
    });

    return updated;
  }

  async reject(id: string, reason: string, user: AuthUser) {
    const existing = await this.findOne(id);
    if (!['RECEIVED', 'APPROVED'].includes(existing.status)) {
      throw new BadRequestException('Only RECEIVED or APPROVED deliveries can be rejected');
    }

    const notes = reason
      ? `[REJECTED] ${reason}${existing.notes ? `\n${existing.notes}` : ''}`
      : existing.notes ?? undefined;

    const updated = await this.prisma.fuelDelivery.update({
      where: { id },
      data: { status: 'REJECTED', notes },
    });

    await this.auditLogs.log({
      action: 'FUEL_DELIVERY_REJECT',
      entityType: 'FuelDelivery',
      entityId: id,
      userId: user.id,
      companyId: updated.companyId,
      oldValue: { status: existing.status },
      newValue: { status: 'REJECTED', reason },
    });

    return updated;
  }

  async cancel(id: string, reason: string, user: AuthUser) {
    const existing = await this.findOne(id);
    if (!['DRAFT', 'RECEIVED'].includes(existing.status)) {
      throw new BadRequestException('Only DRAFT or RECEIVED deliveries can be cancelled');
    }

    const notes = reason
      ? `[CANCELLED] ${reason}${existing.notes ? `\n${existing.notes}` : ''}`
      : existing.notes ?? undefined;

    const updated = await this.prisma.fuelDelivery.update({
      where: { id },
      data: { status: 'CANCELLED', notes },
    });

    await this.auditLogs.log({
      action: 'FUEL_DELIVERY_CANCEL',
      entityType: 'FuelDelivery',
      entityId: id,
      userId: user.id,
      companyId: updated.companyId,
      oldValue: { status: existing.status },
      newValue: { status: 'CANCELLED', reason },
    });

    return updated;
  }

  async post(id: string, user: AuthUser) {
    const delivery = await this.findOne(id);
    if (delivery.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED deliveries can be posted');
    }

    const tank = await this.prisma.fuelTank.findFirst({
      where: { id: delivery.tankId, deletedAt: null },
    });
    if (!tank) throw new NotFoundException('Fuel tank not found');

    const product = await this.prisma.product.findUnique({
      where: { id: delivery.productId },
    });

    await this.inventoryMovements.createMovement({
      companyId: delivery.companyId,
      branchId: delivery.branchId,
      productId: delivery.productId,
      inventoryLocationId: tank.inventoryLocationId ?? '',
      movementType: InventoryMovementType.PURCHASE_RECEIPT,
      quantity: Number(delivery.acceptedLitres),
      unitId: (product as unknown as { unitId?: string })?.unitId ?? '',
      unitCost: delivery.unitCost != null ? Number(delivery.unitCost) : undefined,
      movementDate: new Date(),
      referenceType: 'FUEL_DELIVERY',
      referenceId: delivery.id,
      notes: `Fuel delivery ${delivery.deliveryNumber}`,
      createdById: user.id,
    });

    await this.prisma.fuelTank.update({
      where: { id: delivery.tankId },
      data: { currentBookBalance: { increment: Number(delivery.acceptedLitres) } },
    });

    const updated = await this.prisma.fuelDelivery.update({
      where: { id },
      data: { status: 'POSTED', postedById: user.id, postedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'FUEL_DELIVERY_POST',
      entityType: 'FuelDelivery',
      entityId: id,
      userId: user.id,
      companyId: updated.companyId,
      oldValue: { status: 'APPROVED' },
      newValue: { status: 'POSTED' },
    });

    return updated;
  }

  async softDelete(id: string, user: AuthUser) {
    const existing = await this.findOne(id);
    if (!['DRAFT', 'CANCELLED'].includes(existing.status)) {
      throw new BadRequestException('Only DRAFT or CANCELLED deliveries can be deleted');
    }

    await this.prisma.fuelDelivery.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'FUEL_DELIVERY_DELETE',
      entityType: 'FuelDelivery',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
    });

    return { success: true };
  }
}
