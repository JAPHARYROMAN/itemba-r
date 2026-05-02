import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateParkingSessionDto } from './dto/create-parking-session.dto';
import { UpdateParkingSessionDto } from './dto/update-parking-session.dto';
import { ParkingSessionStatus, ParkingPaymentStatus, ParkingRateType } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

interface CloseSessionInput {
  exitTime?: string;
  rateId?: string;
  closedById: string;
}

@Injectable()
export class ParkingSessionsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateParkingSessionDto, userId: string) {
    const existing = await this.prisma.parkingSession.findFirst({
      where: { companyId: dto.companyId, sessionNumber: dto.sessionNumber, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Session number already exists for this company');

    const session = await this.prisma.parkingSession.create({
      data: {
        ...dto,
        entryTime: dto.entryTime ? new Date(dto.entryTime) : new Date(),
        status: dto.status ?? ParkingSessionStatus.ACTIVE,
      },
    });
    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'ParkingSession',
      entityId: session.id,
      companyId: dto.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return session;
  }

  async findAll(
    companyId?: string,
    facilityId?: string,
    zoneId?: string,
    status?: ParkingSessionStatus,
    paymentStatus?: ParkingPaymentStatus,
    page = 1,
    limit = 20, user?: any,
  ) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (facilityId) where.facilityId = facilityId;
    if (zoneId) where.zoneId = zoneId;
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.parkingSession.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { name: true } },
          facility: { select: { facilityName: true } },
          zone: { select: { zoneName: true } },
          rate: { select: { rateName: true, rateType: true, amount: true } },
          createdBy: { select: { fullName: true } },
          closedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.parkingSession.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const session = await this.prisma.parkingSession.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { name: true } },
        facility: { select: { facilityName: true } },
        zone: { select: { zoneName: true } },
        rate: { select: { rateName: true, rateType: true, amount: true, currency: true } },
        createdBy: { select: { fullName: true } },
        closedBy: { select: { fullName: true } },
        payments: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!session) throw new NotFoundException('Parking session not found');
    return session;
  }

  async update(id: string, dto: UpdateParkingSessionDto, userId: string) {
    const session = await this.findOne(id);
    const updated = await this.prisma.parkingSession.update({
      where: { id },
      data: {
        ...dto,
        entryTime: dto.entryTime ? new Date(dto.entryTime) : undefined,
      },
    });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entityType: 'ParkingSession',
      entityId: id,
      companyId: session.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async close(id: string, body: CloseSessionInput, userId: string) {
    const session = await this.findOne(id);
    if (session.status !== ParkingSessionStatus.ACTIVE) {
      throw new BadRequestException('Only active sessions can be closed');
    }

    const exitTime = body.exitTime ? new Date(body.exitTime) : new Date();
    const entryTime = session.entryTime;
    const durationMs = exitTime.getTime() - entryTime.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);

    const rateId = body.rateId ?? session.rateId ?? undefined;
    let calculatedAmount = 0;

    if (rateId) {
      const rate = await this.prisma.parkingRate.findFirst({ where: { id: rateId, deletedAt: null } });
      if (rate) {
        const rateAmount = Number(rate.amount);
        switch (rate.rateType) {
          case ParkingRateType.HOURLY:
            calculatedAmount = Math.ceil(durationHours) * rateAmount;
            break;
          case ParkingRateType.DAILY:
            calculatedAmount = Math.ceil(durationHours / 24) * rateAmount;
            break;
          case ParkingRateType.WEEKLY:
            calculatedAmount = Math.ceil(durationHours / 168) * rateAmount;
            break;
          case ParkingRateType.MONTHLY:
            calculatedAmount = Math.ceil(durationHours / 720) * rateAmount;
            break;
          case ParkingRateType.OVERNIGHT:
          case ParkingRateType.FLAT:
          case ParkingRateType.CUSTOM:
          default:
            calculatedAmount = rateAmount;
            break;
        }
      }
    }

    const discountAmount = Number(session.discountAmount) || 0;
    const totalAmount = Math.max(0, calculatedAmount - discountAmount);

    const updated = await this.prisma.parkingSession.update({
      where: { id },
      data: {
        exitTime,
        status: ParkingSessionStatus.COMPLETED,
        calculatedAmount,
        totalAmount,
        outstandingAmount: Math.max(0, totalAmount - Number(session.paidAmount)),
        closedById: body.closedById,
        rateId: rateId ?? undefined,
      },
    });
    await this.audit.log({
      userId,
      action: 'CLOSE',
      entityType: 'ParkingSession',
      entityId: id,
      companyId: session.companyId,
      newValue: { exitTime, calculatedAmount, totalAmount, status: ParkingSessionStatus.COMPLETED },
    });
    return updated;
  }

  async voidSession(id: string, userId: string) {
    const session = await this.findOne(id);
    if (session.status === ParkingSessionStatus.VOIDED) {
      throw new BadRequestException('Session is already voided');
    }
    const updated = await this.prisma.parkingSession.update({
      where: { id },
      data: { status: ParkingSessionStatus.VOIDED },
    });
    await this.audit.log({
      userId,
      action: 'VOID',
      entityType: 'ParkingSession',
      entityId: id,
      companyId: session.companyId,
      newValue: { status: ParkingSessionStatus.VOIDED },
    });
    return updated;
  }

  async remove(id: string, userId: string) {
    const session = await this.findOne(id);
    await this.prisma.parkingSession.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId,
      action: 'DELETE',
      entityType: 'ParkingSession',
      entityId: id,
      companyId: session.companyId,
      newValue: {},
    });
    return { message: 'Parking session deleted' };
  }
}
