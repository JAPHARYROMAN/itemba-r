import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { FoliosService } from '../folios/folios.service';
import { CreateRoomBookingDto } from './dto/create-room-booking.dto';
import { UpdateRoomBookingDto } from './dto/update-room-booking.dto';
import { RoomBookingStatus, RoomStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class RoomBookingsService {
  private readonly logger = new Logger(RoomBookingsService.name);
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private folios: FoliosService,
  ) {}

  async create(dto: CreateRoomBookingDto, userId: string) {
    const existing = await this.prisma.roomBooking.findFirst({
      where: { companyId: dto.companyId, bookingNumber: dto.bookingNumber, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Booking number already exists for this company');
    const booking = await this.prisma.roomBooking.create({
      data: {
        ...dto,
        bookingDate: dto.bookingDate ? new Date(dto.bookingDate) : undefined,
        expectedCheckIn: new Date(dto.expectedCheckIn),
        expectedCheckOut: new Date(dto.expectedCheckOut),
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'RoomBooking', entityId: booking.id, newValue: dto as unknown as Record<string, unknown> });
    return booking;
  }

  async findAll(companyId?: string, hospitalityFacilityId?: string, guestId?: string, roomId?: string, status?: RoomBookingStatus, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (hospitalityFacilityId) where.hospitalityFacilityId = hospitalityFacilityId;
    if (guestId) where.guestId = guestId;
    if (roomId) where.roomId = roomId;
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.roomBooking.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
        include: {
          guest: { select: { fullName: true, guestCode: true } },
          room: { select: { roomNumber: true, roomType: true } },
          facility: { select: { facilityName: true } },
        },
      }),
      this.prisma.roomBooking.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const booking = await this.prisma.roomBooking.findFirst({
      where: { id, deletedAt: null },
      include: {
        guest: { select: { fullName: true, guestCode: true, phone: true } },
        room: { select: { roomNumber: true, roomType: true, defaultRate: true } },
        facility: { select: { facilityName: true, facilityCode: true } },
      },
    });
    if (!booking) throw new NotFoundException('Room booking not found');
    return booking;
  }

  async update(id: string, dto: UpdateRoomBookingDto, userId: string) {
    await this.findOne(id);
    const booking = await this.prisma.roomBooking.update({
      where: { id },
      data: {
        ...dto,
        bookingDate: dto.bookingDate ? new Date(dto.bookingDate) : undefined,
        expectedCheckIn: dto.expectedCheckIn ? new Date(dto.expectedCheckIn) : undefined,
        expectedCheckOut: dto.expectedCheckOut ? new Date(dto.expectedCheckOut) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'RoomBooking', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return booking;
  }

  async checkIn(id: string, userId: string) {
    const booking = await this.findOne(id);
    if (booking.status !== RoomBookingStatus.RESERVED) {
      throw new BadRequestException('Booking must be in RESERVED status to check in');
    }
    const updated = await this.prisma.roomBooking.update({
      where: { id },
      data: { actualCheckIn: new Date(), status: RoomBookingStatus.CHECKED_IN, checkedInById: userId },
    });
    await this.prisma.room.update({ where: { id: booking.roomId }, data: { status: RoomStatus.OCCUPIED } });
    await this.audit.log({ userId, action: 'CHECK_IN', entityType: 'RoomBooking', entityId: id, newValue: { status: 'CHECKED_IN' } });

    // Open the running-tab folio for this stay so restaurant/bar/extras can
    // be charged through it. Soft-fails — a configuration miss should not
    // block the check-in itself.
    try {
      await this.folios.openForBooking(id, userId);
    } catch (err) {
      this.logger.warn(
        `Folio open failed for booking ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return updated;
  }

  async checkOut(id: string, userId: string) {
    const booking = await this.findOne(id);
    if (booking.status !== RoomBookingStatus.CHECKED_IN) {
      throw new BadRequestException('Booking must be in CHECKED_IN status to check out');
    }
    const updated = await this.prisma.roomBooking.update({
      where: { id },
      data: { actualCheckOut: new Date(), status: RoomBookingStatus.CHECKED_OUT, checkedOutById: userId },
    });
    await this.prisma.room.update({ where: { id: booking.roomId }, data: { status: RoomStatus.DIRTY } });
    await this.audit.log({ userId, action: 'CHECK_OUT', entityType: 'RoomBooking', entityId: id, newValue: { status: 'CHECKED_OUT' } });

    // Post the final room-nights charge to the folio. We deliberately leave
    // the folio OPEN so the front desk can settle it with the chosen payment
    // method (CASH / MOBILE_MONEY / CARD / CREDIT). The /settle endpoint
    // closes the folio and creates the settlement SalesOrder. The room-
    // nights charge is idempotent so a double check-out doesn't duplicate.
    try {
      const folio = await this.folios.findByBooking(id);
      if (folio && folio.status === 'OPEN') {
        await this.folios.postRoomNightsCharge(folio.id, userId);
      }
    } catch (err) {
      this.logger.warn(
        `Folio room-nights post failed for booking ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return updated;
  }

  async cancel(id: string, userId: string) {
    const booking = await this.findOne(id);
    if (booking.status === RoomBookingStatus.CHECKED_OUT || booking.status === RoomBookingStatus.CANCELLED) {
      throw new BadRequestException('Booking cannot be cancelled in its current status');
    }
    const updated = await this.prisma.roomBooking.update({
      where: { id },
      data: { status: RoomBookingStatus.CANCELLED },
    });
    await this.prisma.room.update({ where: { id: booking.roomId }, data: { status: RoomStatus.AVAILABLE } });
    await this.audit.log({ userId, action: 'CANCEL', entityType: 'RoomBooking', entityId: id, newValue: { status: 'CANCELLED' } });
    return updated;
  }
}
