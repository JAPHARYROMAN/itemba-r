import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRestaurantOrderDto } from './dto/create-restaurant-order.dto';
import { UpdateRestaurantOrderDto } from './dto/update-restaurant-order.dto';
import { AccessLevel, RestaurantOrderStatus, RestaurantOrderType, RestaurantOrderPaymentStatus } from '@prisma/client';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class RestaurantOrdersService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateRestaurantOrderDto, userId: string, user?: AuthUser) {
    // ITMB-073: ensure the caller may write to the target company before insert.
    if (user) assertCanAccessCompanyFromUser(user, dto.companyId, AccessLevel.WRITE);

    const existing = await this.prisma.restaurantOrder.findFirst({
      where: { companyId: dto.companyId, orderNumber: dto.orderNumber, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Order number already exists for this company');

    const { lines, ...orderData } = dto;

    // ITMB-002 / ITMB-038: never trust client-supplied monetary totals or
    // paymentStatus. Compute all line and header amounts server-side from the
    // validated lines, and initialise the order as fully unpaid.
    const computedLines = (lines ?? []).map((line) => {
      const quantity = Number(line.quantity) || 0;
      const unitPrice = Number(line.unitPrice) || 0;
      const lineDiscount = Number(line.discountAmount) || 0;
      const lineTax = Number(line.taxAmount) || 0;
      const lineTotal = quantity * unitPrice - lineDiscount + lineTax;
      return {
        menuItemId: line.menuItemId,
        quantity,
        unitPrice,
        discountAmount: lineDiscount,
        taxAmount: lineTax,
        productId: line.productId,
        notes: line.notes,
        lineTotal,
      };
    });

    const subtotal = computedLines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const taxAmount = computedLines.reduce((sum, l) => sum + l.taxAmount, 0);
    const discountAmount = computedLines.reduce((sum, l) => sum + l.discountAmount, 0);
    const totalAmount = subtotal - discountAmount + taxAmount;

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.restaurantOrder.create({
        data: {
          ...orderData,
          orderDate: new Date(orderData.orderDate),
          subtotal,
          discountAmount,
          taxAmount,
          totalAmount,
          paidAmount: 0,
          outstandingAmount: totalAmount,
          paymentStatus: RestaurantOrderPaymentStatus.UNPAID,
        },
      });
      if (computedLines.length > 0) {
        await tx.restaurantOrderLine.createMany({
          data: computedLines.map((line) => ({ ...line, restaurantOrderId: created.id })),
        });
      }
      return tx.restaurantOrder.findUniqueOrThrow({
        where: { id: created.id },
        include: { lines: true },
      });
    });

    await this.audit.log({ userId, action: 'CREATE', entityType: 'RestaurantOrder', entityId: order.id, newValue: dto as unknown as Record<string, unknown> });
    return order;
  }

  async findAll(companyId?: string, hospitalityFacilityId?: string, tableId?: string, guestId?: string, status?: RestaurantOrderStatus, orderType?: RestaurantOrderType, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (hospitalityFacilityId) where.hospitalityFacilityId = hospitalityFacilityId;
    if (tableId) where.tableId = tableId;
    if (guestId) where.guestId = guestId;
    if (status) where.status = status;
    if (orderType) where.orderType = orderType;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.restaurantOrder.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
        include: {
          table: { select: { tableNumber: true } },
          guest: { select: { fullName: true } },
        },
      }),
      this.prisma.restaurantOrder.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, user?: any) {
    // ITMB-073: scope the lookup to companies the caller may access so order
    // details cannot be read cross-tenant by id.
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const order = await this.prisma.restaurantOrder.findFirst({
      where,
      include: {
        lines: { include: { menuItem: { select: { name: true, itemType: true } } } },
        table: { select: { tableNumber: true } },
        guest: { select: { fullName: true, guestCode: true } },
        facility: { select: { facilityName: true } },
      },
    });
    if (!order) throw new NotFoundException('Restaurant order not found');
    return order;
  }

  async update(id: string, dto: UpdateRestaurantOrderDto, userId: string) {
    await this.findOne(id);
    const { lines, ...orderData } = dto;
    const order = await this.prisma.restaurantOrder.update({
      where: { id },
      data: {
        ...orderData,
        orderDate: orderData.orderDate ? new Date(orderData.orderDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'RestaurantOrder', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return order;
  }

  async complete(id: string, userId: string) {
    const order = await this.findOne(id);
    if (order.status === RestaurantOrderStatus.COMPLETED || order.status === RestaurantOrderStatus.VOIDED) {
      throw new BadRequestException('Order is already completed or voided');
    }
    const updated = await this.prisma.restaurantOrder.update({
      where: { id },
      data: { status: RestaurantOrderStatus.COMPLETED },
    });
    await this.audit.log({ userId, action: 'COMPLETE', entityType: 'RestaurantOrder', entityId: id, newValue: { status: 'COMPLETED' } });
    return updated;
  }

  async void(id: string, userId: string) {
    const order = await this.findOne(id);
    if (order.status === RestaurantOrderStatus.VOIDED) {
      throw new BadRequestException('Order is already voided');
    }
    const updated = await this.prisma.restaurantOrder.update({
      where: { id },
      data: { status: RestaurantOrderStatus.VOIDED },
    });
    await this.audit.log({ userId, action: 'VOID', entityType: 'RestaurantOrder', entityId: id, newValue: { status: 'VOIDED' } });
    return updated;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.restaurantOrder.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'RestaurantOrder', entityId: id, newValue: {} });
    return { message: 'Restaurant order deleted' };
  }
}
