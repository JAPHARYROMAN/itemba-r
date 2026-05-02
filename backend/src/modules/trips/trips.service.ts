import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

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
  ) {}

  async create(dto: CreateTripDto, userId: string) {
    const tripNumber = await this.codes.next({ entityType: 'Trip', companyId: dto.companyId });
    const trip = await this.prisma.trip.create({
      data: { ...dto, tripNumber, tripDate: new Date(dto.tripDate), expectedReturnDate: dto.expectedReturnDate ? new Date(dto.expectedReturnDate) : undefined, createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'Trip', entityId: trip.id, newValue: dto as unknown as Record<string, unknown> });
    return trip;
  }

  async findAll(companyId?: string, status?: TripStatus, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { tripDate: 'desc' }, include: { vehicle: { select: { vehicleCode: true, registrationNumber: true } }, driver: { select: { fullName: true, driverCode: true } }, route: { select: { name: true } } } }),
      this.prisma.trip.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const t = await this.prisma.trip.findFirst({ where: { id, deletedAt: null }, include: { vehicle: true, driver: true, route: true, expenses: { where: { deletedAt: null } }, fuelUsage: { where: { deletedAt: null } } } });
    if (!t) throw new NotFoundException('Trip not found');
    return t;
  }

  async dispatch(id: string, userId: string) {
    const trip = await this.findOne(id);
    if (trip.status !== TripStatus.PLANNED) throw new BadRequestException('Only PLANNED trips can be dispatched');
    const updated = await this.prisma.trip.update({ where: { id }, data: { status: TripStatus.DISPATCHED, dispatchedById: userId } });
    await this.audit.log({ userId, action: 'DISPATCH', entityType: 'Trip', entityId: id, newValue: { status: 'DISPATCHED' } });
    return updated;
  }

  async markInTransit(id: string, userId: string) {
    const trip = await this.findOne(id);
    if (trip.status !== TripStatus.DISPATCHED) throw new BadRequestException('Only DISPATCHED trips can be marked IN_TRANSIT');
    return this.prisma.trip.update({ where: { id }, data: { status: TripStatus.IN_TRANSIT } });
  }

  async complete(id: string, actualReturnDate: string, userId: string) {
    const trip = await this.findOne(id);
    if (!([TripStatus.DISPATCHED, TripStatus.IN_TRANSIT] as string[]).includes(trip.status)) throw new BadRequestException('Only DISPATCHED or IN_TRANSIT trips can be completed');
    const updated = await this.prisma.trip.update({ where: { id }, data: { status: TripStatus.COMPLETED, actualReturnDate: new Date(actualReturnDate), completedById: userId } });
    await this.audit.log({ userId, action: 'COMPLETE', entityType: 'Trip', entityId: id, newValue: { status: 'COMPLETED' } });
    return updated;
  }

  async close(id: string, user: import('../../common/decorators/current-user.decorator').AuthUser) {
    const userId = user.id;
    const trip = await this.findOne(id);
    if (trip.status !== TripStatus.COMPLETED) throw new BadRequestException('Only COMPLETED trips can be closed');

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
      newValue: { status: 'CLOSED', salesOrderId, receivableId } as unknown as Record<string, unknown>,
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
    if (!unit) throw new BadRequestException('System "Service" unit (svc) is missing — re-run the seed.');

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

  async cancel(id: string, userId: string) {
    const trip = await this.findOne(id);
    if (([TripStatus.COMPLETED, TripStatus.CLOSED] as string[]).includes(trip.status)) throw new BadRequestException('Cannot cancel a completed or closed trip');
    const updated = await this.prisma.trip.update({ where: { id }, data: { status: TripStatus.CANCELLED } });
    await this.audit.log({ userId, action: 'CANCEL', entityType: 'Trip', entityId: id, newValue: { status: 'CANCELLED' } });
    return updated;
  }

  async getProfitability(id: string) {
    const trip = await this.findOne(id);
    const totalExpenses = await this.prisma.tripExpense.aggregate({ where: { tripId: id, deletedAt: null }, _sum: { amount: true } });
    const totalFuel = await this.prisma.tripFuelUsage.aggregate({ where: { tripId: id, deletedAt: null }, _sum: { totalCost: true } });
    const totalCost = Number(totalExpenses._sum.amount || 0) + Number(totalFuel._sum.totalCost || 0);
    return { tripNumber: trip.tripNumber, revenue: Number(trip.revenueAmount), totalCost, profit: Number(trip.revenueAmount) - totalCost, profitMargin: Number(trip.revenueAmount) > 0 ? ((Number(trip.revenueAmount) - totalCost) / Number(trip.revenueAmount)) * 100 : 0 };
  }

  async update(id: string, dto: UpdateTripDto, userId: string) {
    await this.findOne(id);
    const trip = await this.prisma.trip.update({ where: { id }, data: { ...dto, tripDate: dto.tripDate ? new Date(dto.tripDate) : undefined, expectedReturnDate: dto.expectedReturnDate ? new Date(dto.expectedReturnDate) : undefined } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'Trip', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return trip;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.trip.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'Trip', entityId: id, newValue: {} });
    return { message: 'Trip deleted' };
  }
}
