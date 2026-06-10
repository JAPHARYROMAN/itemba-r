import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { AccessLevel, TripStatus } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService, applyCompanyScopeWhere } from '../../common/services';

const LOGISTICS_PRODUCT_CODE = 'TRANSPORT-SVC';
const LOGISTICS_CATEGORY_NAME = 'Transport Services';
const SERVICE_UNIT_SYMBOL = 'svc';

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private salesOrders: SalesOrdersService,
    private codes: EntityCodeGeneratorService,
    private companyScope: CompanyScopeService,
  ) {}

  async create(dto: CreateTripDto, user: AuthUser) {
    const userId = user.id;
    const data = this.normalizeCreateData(dto);

    await this.companyScope.assertCanAccessCompany(user, data.companyId, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(data);

    const tripNumber = await this.codes.next({ entityType: 'Trip', companyId: data.companyId });
    const trip = await this.prisma.trip.create({
      data: { ...data, tripNumber, createdById: userId },
    });
    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'Trip',
      entityId: trip.id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return trip;
  }

  async findAll(
    companyId?: string,
    status?: TripStatus,
    page = 1,
    limit = 20,
    user?: any,
    from?: string,
    to?: string,
  ) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    if (from || to) {
      where.tripDate = {};
      if (from) where.tripDate.gte = new Date(from);
      if (to) where.tripDate.lte = new Date(to);
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { tripDate: 'desc' },
        include: {
          vehicle: { select: { vehicleCode: true, registrationNumber: true } },
          driver: { select: { fullName: true, driverCode: true } },
          route: { select: { name: true } },
        },
      }),
      this.prisma.trip.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const t = await this.prisma.trip.findFirst({
      where: { id, deletedAt: null },
      include: {
        vehicle: true,
        driver: true,
        route: true,
        expenses: { where: { deletedAt: null } },
        fuelUsage: { where: { deletedAt: null } },
      },
    });
    if (!t) throw new NotFoundException('Trip not found');
    await this.companyScope.assertCanAccessCompany(user, t.companyId, minimum);
    return t;
  }

  async dispatch(id: string, user: AuthUser) {
    const userId = user.id;
    const trip = await this.findOne(id, user, AccessLevel.WRITE);
    if (trip.status !== TripStatus.PLANNED)
      throw new BadRequestException('Only PLANNED trips can be dispatched');
    const updated = await this.prisma.trip.update({
      where: { id },
      data: { status: TripStatus.DISPATCHED, dispatchedById: userId },
    });
    await this.audit.log({
      userId,
      action: 'DISPATCH',
      entityType: 'Trip',
      entityId: id,
      newValue: { status: 'DISPATCHED' },
    });
    return updated;
  }

  async markInTransit(id: string, user: AuthUser) {
    const trip = await this.findOne(id, user, AccessLevel.WRITE);
    if (trip.status !== TripStatus.DISPATCHED)
      throw new BadRequestException('Only DISPATCHED trips can be marked IN_TRANSIT');
    return this.prisma.trip.update({ where: { id }, data: { status: TripStatus.IN_TRANSIT } });
  }

  async complete(id: string, actualReturnDate: string, user: AuthUser) {
    const userId = user.id;
    const trip = await this.findOne(id, user, AccessLevel.WRITE);
    if (!([TripStatus.DISPATCHED, TripStatus.IN_TRANSIT] as string[]).includes(trip.status))
      throw new BadRequestException('Only DISPATCHED or IN_TRANSIT trips can be completed');
    const updated = await this.prisma.trip.update({
      where: { id },
      data: {
        status: TripStatus.COMPLETED,
        actualReturnDate: new Date(actualReturnDate),
        completedById: userId,
      },
    });
    await this.audit.log({
      userId,
      action: 'COMPLETE',
      entityType: 'Trip',
      entityId: id,
      newValue: { status: 'COMPLETED' },
    });
    return updated;
  }

  async close(id: string, user: import('../../common/decorators/current-user.decorator').AuthUser) {
    const userId = user.id;
    const trip = await this.findOne(id, user, AccessLevel.WRITE);
    if (trip.status !== TripStatus.COMPLETED)
      throw new BadRequestException('Only COMPLETED trips can be closed');

    // ── Revenue closure (Sprint I4) ───────────────────────────────────────
    // On close, if the trip has a customer + revenue set, create a CREDIT
    // SalesOrder so revenue books to the GL. Confirming the SalesOrder
    // automatically opens a Receivable. Idempotent: skip if salesOrderId
    // already linked. Soft-fails (logs + still flips to CLOSED) so a config
    // gap doesn't block the operational status transition.
    let salesOrderId = trip.salesOrderId ?? null;
    let receivableId = trip.receivableId ?? null;
    const revenueAmount = Number(trip.revenueAmount ?? 0);

    if (!salesOrderId && trip.customerId && revenueAmount > 0) {
      try {
        const product = await this.ensureLogisticsServiceProduct(trip.companyId);
        const description = `Trip ${trip.tripNumber}: ${trip.origin} → ${trip.destination}${
          trip.cargoDescription ? ` (${trip.cargoDescription})` : ''
        }`;
        const created = await this.salesOrders.create(
          {
            companyId: trip.companyId,
            divisionId: trip.divisionId,
            branchId: trip.branchId ?? undefined,
            customerId: trip.customerId,
            customerName: trip.customerName ?? undefined,
            salesType: 'SERVICE' as any,
            orderDate: new Date().toISOString(),
            currency: trip.currency as any,
            paymentMethod: 'CREDIT' as any,
            notes: `Logistics — ${description}`,
            lines: [
              {
                productId: product.id,
                description,
                quantity: 1,
                unitId: product.baseUnitId,
                unitPrice: revenueAmount,
                discountAmount: 0,
                taxAmount: 0,
              },
            ],
            createdById: userId,
          } as any,
          user,
        );
        const confirmed = await this.salesOrders.confirm(created.id, user);
        salesOrderId = confirmed.id;
        receivableId = confirmed.receivableId ?? null;
      } catch (err) {
        this.logger.warn(
          `Auto-revenue creation failed for trip ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (!trip.customerId || revenueAmount <= 0) {
      // Internal / non-revenue trip — close it but flag in audit so reports
      // can distinguish "delivered for a customer" vs "deadhead/internal".
      this.logger.log(
        `Trip ${trip.tripNumber} closing without revenue (customerId=${trip.customerId ?? 'none'}, revenueAmount=${revenueAmount}).`,
      );
    }

    const updated = await this.prisma.trip.update({
      where: { id },
      data: {
        status: TripStatus.CLOSED,
        closedById: userId,
        ...(salesOrderId ? { salesOrderId } : {}),
        ...(receivableId ? { receivableId } : {}),
      },
    });
    await this.audit.log({
      userId,
      action: 'CLOSE',
      entityType: 'Trip',
      entityId: id,
      newValue: { status: 'CLOSED', salesOrderId, receivableId } as unknown as Record<
        string,
        unknown
      >,
    });
    return updated;
  }

  /**
   * Lazily ensure a per-company "Transport Service" Product exists so trip
   * SalesOrder lines have a productId. Same pattern as W5.5 hospitality and
   * I1 construction. Idempotent on (companyId, productCode).
   */
  private async ensureLogisticsServiceProduct(companyId: string) {
    const existing = await this.prisma.product.findFirst({
      where: { companyId, productCode: LOGISTICS_PRODUCT_CODE, deletedAt: null },
      select: { id: true, baseUnitId: true },
    });
    if (existing) return existing;

    let category = await this.prisma.productCategory.findFirst({
      where: { companyId, name: LOGISTICS_CATEGORY_NAME, deletedAt: null },
      select: { id: true },
    });
    if (!category) {
      const created = await this.prisma.productCategory.create({
        data: {
          companyId,
          name: LOGISTICS_CATEGORY_NAME,
          categoryType: 'SERVICE',
          description: 'Auto-created for trip revenue settlement.',
        },
      });
      category = { id: created.id };
    }

    const unit = await this.prisma.unitOfMeasure.findFirst({
      where: { symbol: SERVICE_UNIT_SYMBOL, isSystemUnit: true },
      select: { id: true },
    });
    if (!unit)
      throw new BadRequestException('System "Service" unit (svc) is missing — re-run the seed.');

    return this.prisma.product.create({
      data: {
        companyId,
        productCode: LOGISTICS_PRODUCT_CODE,
        categoryId: category.id,
        name: 'Transport Service',
        description: 'Generic non-inventory service line for trip revenue settlements.',
        productType: 'SERVICE',
        baseUnitId: unit.id,
        trackInventory: false,
        trackBatch: false,
        trackExpiry: false,
        isTaxable: false,
        status: 'ACTIVE',
      },
      select: { id: true, baseUnitId: true },
    });
  }

  async cancel(id: string, user: AuthUser) {
    const userId = user.id;
    const trip = await this.findOne(id, user, AccessLevel.WRITE);
    if (([TripStatus.COMPLETED, TripStatus.CLOSED] as string[]).includes(trip.status))
      throw new BadRequestException('Cannot cancel a completed or closed trip');
    const updated = await this.prisma.trip.update({
      where: { id },
      data: { status: TripStatus.CANCELLED },
    });
    await this.audit.log({
      userId,
      action: 'CANCEL',
      entityType: 'Trip',
      entityId: id,
      newValue: { status: 'CANCELLED' },
    });
    return updated;
  }

  async getProfitability(id: string, user: AuthUser) {
    const trip = await this.findOne(id, user);
    const totalExpenses = await this.prisma.tripExpense.aggregate({
      where: { tripId: id, deletedAt: null },
      _sum: { amount: true },
    });
    const totalFuel = await this.prisma.tripFuelUsage.aggregate({
      where: { tripId: id, deletedAt: null },
      _sum: { totalCost: true },
    });
    const totalCost =
      Number(totalExpenses._sum.amount || 0) + Number(totalFuel._sum.totalCost || 0);
    return {
      tripNumber: trip.tripNumber,
      revenue: Number(trip.revenueAmount),
      totalCost,
      profit: Number(trip.revenueAmount) - totalCost,
      profitMargin:
        Number(trip.revenueAmount) > 0
          ? ((Number(trip.revenueAmount) - totalCost) / Number(trip.revenueAmount)) * 100
          : 0,
    };
  }

  async update(id: string, dto: UpdateTripDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);

    if (dto.companyId && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Trip company cannot be changed');
    }

    const data = this.normalizeUpdateData(dto);
    await this.assertReferencesBelongToCompany({
      companyId: existing.companyId,
      divisionId: data.divisionId ?? existing.divisionId,
      vehicleId: data.vehicleId ?? existing.vehicleId,
      driverId: data.driverId ?? existing.driverId,
      branchId: data.branchId === undefined ? existing.branchId : data.branchId,
      customerId: data.customerId === undefined ? existing.customerId : data.customerId,
      routeId: data.routeId === undefined ? existing.routeId : data.routeId,
      cargoUnitId: data.cargoUnitId === undefined ? existing.cargoUnitId : data.cargoUnitId,
    });

    const trip = await this.prisma.trip.update({ where: { id }, data });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entityType: 'Trip',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return trip;
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    await this.findOne(id, user, AccessLevel.WRITE);
    await this.prisma.trip.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId,
      action: 'DELETE',
      entityType: 'Trip',
      entityId: id,
      newValue: {},
    });
    return { message: 'Trip deleted' };
  }

  private normalizeCreateData(dto: CreateTripDto) {
    const branchId = this.optionalText(dto.branchId);
    const customerId = this.optionalText(dto.customerId);
    const customerName = this.optionalText(dto.customerName);
    const routeId = this.optionalText(dto.routeId);
    const cargoDescription = this.optionalText(dto.cargoDescription);
    const cargoUnitId = this.optionalText(dto.cargoUnitId);
    const expectedReturnDate = this.optionalText(dto.expectedReturnDate);
    const notes = this.optionalText(dto.notes);

    return {
      companyId: this.requiredText(dto.companyId, 'Company'),
      divisionId: this.requiredText(dto.divisionId, 'Division'),
      vehicleId: this.requiredText(dto.vehicleId, 'Vehicle'),
      driverId: this.requiredText(dto.driverId, 'Driver'),
      origin: this.requiredText(dto.origin, 'Origin'),
      destination: this.requiredText(dto.destination, 'Destination'),
      tripDate: new Date(this.requiredText(dto.tripDate, 'Trip date')),
      currency: this.requiredText(dto.currency, 'Currency'),
      ...(branchId && { branchId }),
      ...(customerId && { customerId }),
      ...(customerName && { customerName }),
      ...(routeId && { routeId }),
      ...(cargoDescription && { cargoDescription }),
      ...(dto.cargoWeight !== undefined && { cargoWeight: dto.cargoWeight }),
      ...(cargoUnitId && { cargoUnitId }),
      ...(expectedReturnDate && { expectedReturnDate: new Date(expectedReturnDate) }),
      ...(dto.revenueAmount !== undefined && { revenueAmount: dto.revenueAmount }),
      ...(notes && { notes }),
    };
  }

  private normalizeUpdateData(dto: UpdateTripDto) {
    const data: Record<string, any> = {};

    if (dto.divisionId !== undefined)
      data.divisionId = this.requiredText(dto.divisionId, 'Division');
    if (dto.branchId !== undefined) data.branchId = this.optionalText(dto.branchId) ?? null;
    if (dto.customerId !== undefined) data.customerId = this.optionalText(dto.customerId) ?? null;
    if (dto.customerName !== undefined)
      data.customerName = this.optionalText(dto.customerName) ?? null;
    if (dto.vehicleId !== undefined) data.vehicleId = this.requiredText(dto.vehicleId, 'Vehicle');
    if (dto.driverId !== undefined) data.driverId = this.requiredText(dto.driverId, 'Driver');
    if (dto.routeId !== undefined) data.routeId = this.optionalText(dto.routeId) ?? null;
    if (dto.origin !== undefined) data.origin = this.requiredText(dto.origin, 'Origin');
    if (dto.destination !== undefined)
      data.destination = this.requiredText(dto.destination, 'Destination');
    if (dto.cargoDescription !== undefined)
      data.cargoDescription = this.optionalText(dto.cargoDescription) ?? null;
    if (dto.cargoWeight !== undefined) data.cargoWeight = dto.cargoWeight;
    if (dto.cargoUnitId !== undefined)
      data.cargoUnitId = this.optionalText(dto.cargoUnitId) ?? null;
    if (dto.tripDate !== undefined)
      data.tripDate = new Date(this.requiredText(dto.tripDate, 'Trip date'));
    if (dto.expectedReturnDate !== undefined) {
      const expectedReturnDate = this.optionalText(dto.expectedReturnDate);
      data.expectedReturnDate = expectedReturnDate ? new Date(expectedReturnDate) : null;
    }
    if (dto.revenueAmount !== undefined) data.revenueAmount = dto.revenueAmount;
    if (dto.currency !== undefined) data.currency = this.requiredText(dto.currency, 'Currency');
    if (dto.notes !== undefined) data.notes = this.optionalText(dto.notes) ?? null;

    return data;
  }

  private requiredText(value: string | undefined, label: string) {
    const text = value?.trim();
    if (!text) throw new BadRequestException(`${label} is required`);
    return text;
  }

  private optionalText(value: string | undefined | null) {
    const text = value?.trim();
    return text || undefined;
  }

  private async assertReferencesBelongToCompany(refs: {
    companyId: string;
    divisionId: string;
    vehicleId: string;
    driverId: string;
    branchId?: string | null;
    customerId?: string | null;
    routeId?: string | null;
    cargoUnitId?: string | null;
  }) {
    const [division, vehicle, driver] = await Promise.all([
      this.prisma.division.findFirst({
        where: { id: refs.divisionId, companyId: refs.companyId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.vehicle.findFirst({
        where: { id: refs.vehicleId, companyId: refs.companyId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.driverProfile.findFirst({
        where: { id: refs.driverId, companyId: refs.companyId, deletedAt: null },
        select: { id: true },
      }),
    ]);

    if (!division) throw new BadRequestException('Division does not belong to this company');
    if (!vehicle) throw new BadRequestException('Vehicle does not belong to this company');
    if (!driver) throw new BadRequestException('Driver does not belong to this company');

    if (refs.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: refs.branchId, deletedAt: null },
        select: { division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== refs.companyId) {
        throw new BadRequestException('Branch does not belong to this company');
      }
    }

    if (refs.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: refs.customerId, companyId: refs.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) throw new BadRequestException('Customer does not belong to this company');
    }

    if (refs.routeId) {
      const route = await this.prisma.route.findFirst({
        where: { id: refs.routeId, companyId: refs.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!route) throw new BadRequestException('Route does not belong to this company');
    }

    if (refs.cargoUnitId) {
      const unit = await this.prisma.unitOfMeasure.findFirst({
        where: {
          id: refs.cargoUnitId,
          deletedAt: null,
          status: 'ACTIVE',
          OR: [{ companyId: refs.companyId }, { companyId: null }, { isSystemUnit: true }],
        },
        select: { id: true },
      });
      if (!unit) throw new BadRequestException('Cargo unit does not belong to this company');
    }
  }
}
