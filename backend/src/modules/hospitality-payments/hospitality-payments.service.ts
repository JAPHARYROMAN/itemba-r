import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateHospitalityPaymentDto } from './dto/create-hospitality-payment.dto';
import { HospitalityPaymentContextType, RestaurantOrderPaymentStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class HospitalityPaymentsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateHospitalityPaymentDto, userId: string) {
    const { guestId: _guestId, ...paymentData } = dto;

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
        const booking = await tx.roomBooking.findUniqueOrThrow({ where: { id: dto.roomBookingId } });
        const newPaid = Number(booking.paidAmount) + dto.amount;
        const newOutstanding = Number(booking.outstandingAmount) - dto.amount;
        await tx.roomBooking.update({
          where: { id: dto.roomBookingId },
          data: { paidAmount: newPaid, outstandingAmount: newOutstanding },
        });
      }

      if (dto.restaurantOrderId) {
        const order = await tx.restaurantOrder.findUniqueOrThrow({ where: { id: dto.restaurantOrderId } });
        const newPaid = Number(order.paidAmount) + dto.amount;
        const newOutstanding = Number(order.outstandingAmount) - dto.amount;
        await tx.restaurantOrder.update({
          where: { id: dto.restaurantOrderId },
          data: {
            paidAmount: newPaid,
            outstandingAmount: newOutstanding,
            paymentStatus: newOutstanding <= 0 ? RestaurantOrderPaymentStatus.PAID : order.paymentStatus,
          },
        });
      }

      return created;
    });

    await this.audit.log({ userId, action: 'CREATE', entityType: 'HospitalityPayment', entityId: payment.id, newValue: dto as unknown as Record<string, unknown> });
    return payment;
  }

  async findAll(companyId?: string, roomBookingId?: string, restaurantOrderId?: string, paymentContextType?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (roomBookingId) where.roomBookingId = roomBookingId;
    if (restaurantOrderId) where.restaurantOrderId = restaurantOrderId;
    if (paymentContextType) where.paymentContextType = paymentContextType;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.hospitalityPayment.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
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
