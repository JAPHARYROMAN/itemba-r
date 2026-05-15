import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateHospitalityPaymentDto } from './dto/create-hospitality-payment.dto';
import {
  HospitalityPaymentContextType,
  Prisma,
  RestaurantOrderPaymentStatus,
} from '@prisma/client';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class HospitalityPaymentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private companyScope: CompanyScopeService,
  ) {}

  async create(dto: CreateHospitalityPaymentDto, user: AuthUser) {
    const { guestId: _guestId, ...paymentData } = dto;
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Payment amount must be greater than zero');
    await this.companyScope.assertCanAccessCompany(user, dto.companyId);

    if (dto.idempotencyKey) {
      const replay = await this.prisma.hospitalityPayment.findFirst({
        where: {
          companyId: dto.companyId,
          idempotencyKey: dto.idempotencyKey,
          deletedAt: null,
        },
      });
      if (replay) return replay;
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.hospitalityPayment.create({
        data: {
          ...paymentData,
          paymentContextType: paymentData.paymentContextType as HospitalityPaymentContextType,
          paymentContextId: paymentData.paymentContextId as string,
          paymentDate: new Date(paymentData.paymentDate),
        },
      });

      if (dto.roomBookingId) {
        const [booking] = await tx.$queryRaw<
          Array<{ id: string; paidAmount: Prisma.Decimal; outstandingAmount: Prisma.Decimal }>
        >`SELECT "id", "paidAmount", "outstandingAmount"
          FROM "room_bookings"
          WHERE "id" = ${dto.roomBookingId} AND "deletedAt" IS NULL
          FOR UPDATE`;
        if (!booking) throw new NotFoundException('Room booking not found');
        const newPaid = new Prisma.Decimal(booking.paidAmount).plus(amount);
        const newOutstanding = new Prisma.Decimal(booking.outstandingAmount).minus(amount);
        await tx.roomBooking.update({
          where: { id: dto.roomBookingId },
          data: { paidAmount: newPaid, outstandingAmount: newOutstanding },
        });
      }

      if (dto.restaurantOrderId) {
        const [order] = await tx.$queryRaw<
          Array<{
            id: string;
            paidAmount: Prisma.Decimal;
            outstandingAmount: Prisma.Decimal;
            paymentStatus: RestaurantOrderPaymentStatus;
          }>
        >`SELECT "id", "paidAmount", "outstandingAmount", "paymentStatus"
          FROM "restaurant_orders"
          WHERE "id" = ${dto.restaurantOrderId} AND "deletedAt" IS NULL
          FOR UPDATE`;
        if (!order) throw new NotFoundException('Restaurant order not found');
        const newPaid = new Prisma.Decimal(order.paidAmount).plus(amount);
        const newOutstanding = new Prisma.Decimal(order.outstandingAmount).minus(amount);
        await tx.restaurantOrder.update({
          where: { id: dto.restaurantOrderId },
          data: {
            paidAmount: newPaid,
            outstandingAmount: newOutstanding,
            paymentStatus: newOutstanding.lte(0)
              ? RestaurantOrderPaymentStatus.PAID
              : order.paymentStatus,
          },
        });
      }

      return created;
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'HospitalityPayment',
      entityId: payment.id,
      companyId: dto.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return payment;
  }

  async findAll(
    companyId?: string,
    roomBookingId?: string,
    restaurantOrderId?: string,
    paymentContextType?: string,
    page = 1,
    limit = 20,
    user?: any,
  ) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (roomBookingId) where.roomBookingId = roomBookingId;
    if (restaurantOrderId) where.restaurantOrderId = restaurantOrderId;
    if (paymentContextType) where.paymentContextType = paymentContextType;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.hospitalityPayment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          receivedBy: { select: { fullName: true } },
          roomBooking: { select: { bookingNumber: true } },
          restaurantOrder: { select: { orderNumber: true } },
        },
      }),
      this.prisma.hospitalityPayment.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const payment = await this.prisma.hospitalityPayment.findFirst({
      where: { id, deletedAt: null },
      include: {
        receivedBy: { select: { fullName: true } },
        roomBooking: { select: { bookingNumber: true, guestId: true } },
        restaurantOrder: { select: { orderNumber: true } },
      },
    });
    if (!payment) throw new NotFoundException('Hospitality payment not found');
    return payment;
  }
}
