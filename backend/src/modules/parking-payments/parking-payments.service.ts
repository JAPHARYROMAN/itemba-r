import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateParkingPaymentDto } from './dto/create-parking-payment.dto';
import { ParkingPaymentStatus } from '@prisma/client';

@Injectable()
export class ParkingPaymentsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateParkingPaymentDto, userId: string) {
    if (dto.idempotencyKey) {
      const replay = await this.prisma.parkingPayment.findFirst({
        where: {
          companyId: dto.companyId,
          idempotencyKey: dto.idempotencyKey,
          deletedAt: null,
        },
      });
      if (replay) return replay;
    }

    const existing = await this.prisma.parkingPayment.findFirst({
      where: { companyId: dto.companyId, paymentNumber: dto.paymentNumber, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Payment number already exists for this company');

    // Payment + session balance must be atomic.
    const payment = await this.prisma.$transaction(async (tx) => {
      const session = await tx.parkingSession.findFirst({
        where: { id: dto.parkingSessionId, deletedAt: null },
      });
      if (!session) throw new NotFoundException('Parking session not found');

      const created = await tx.parkingPayment.create({
        data: {
          ...dto,
          paymentDate: new Date(dto.paymentDate),
        },
      });

      const newPaidAmount = Number(session.paidAmount) + dto.amount;
      const newOutstandingAmount = Math.max(0, Number(session.outstandingAmount) - dto.amount);
      const newPaymentStatus =
        newOutstandingAmount <= 0 ? ParkingPaymentStatus.PAID : ParkingPaymentStatus.PARTIALLY_PAID;

      await tx.parkingSession.update({
        where: { id: dto.parkingSessionId },
        data: {
          paidAmount: newPaidAmount,
          outstandingAmount: newOutstandingAmount,
          paymentStatus: newPaymentStatus,
        },
      });

      return created;
    });

    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'ParkingPayment',
      entityId: payment.id,
      companyId: dto.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return payment;
  }

  async findAll(companyId?: string, parkingSessionId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (parkingSessionId) where.parkingSessionId = parkingSessionId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.parkingPayment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { name: true } },
          parkingSession: { select: { sessionNumber: true, truckNumber: true } },
          receivedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.parkingPayment.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const payment = await this.prisma.parkingPayment.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { name: true } },
        parkingSession: { select: { sessionNumber: true, truckNumber: true, totalAmount: true, paidAmount: true } },
        receivedBy: { select: { fullName: true } },
      },
    });
    if (!payment) throw new NotFoundException('Parking payment not found');
    return payment;
  }
}
