import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RoomBookingStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { applyCompanyScopeWhere } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { FoliosService } from '../folios/folios.service';
import { CreateRoomBookingDto } from './dto/create-room-booking.dto';
import { UpdateRoomBookingDto } from './dto/update-room-booking.dto';

@Injectable()
export class RoomBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly folios: FoliosService,
  ) {}

  private async assertNoConflict(
    companyId: string,
    roomId: string,
    expectedCheckIn: Date,
    expectedCheckOut: Date,
    excludeId?: string,
  ) {
    const conflict = await this.prisma.roomBooking.findFirst({
      where: {
        companyId,
        roomId,
        deletedAt: null,
        status: { notIn: [RoomBookingStatus.CANCELLED, RoomBookingStatus.CHECKED_OUT] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
        // Overlap: existing.expectedCheckIn < newEnd AND existing.expectedCheckOut > newStart.
        expectedCheckIn: { lt: expectedCheckOut },
        expectedCheckOut: { gt: expectedCheckIn },
      },
    });
    if (conflict) {
      throw new ConflictException('Room is already booked for the selected time window');
    }
  }

  async create(dto: CreateRoomBookingDto, user: AuthUser) {
    const expectedCheckIn = new Date(dto.expectedCheckIn);
    const expectedCheckOut = new Date(dto.expectedCheckOut);
    if (expectedCheckOut <= expectedCheckIn) {
      throw new BadRequestException('Expected check-out must be after check-in');
    }
    await this.assertNoConflict(
      dto.companyId,
      dto.roomId,
      expectedCheckIn,
      expectedCheckOut,
    );
    const nights = dto.nights ?? Math.max(1, Math.ceil((expectedCheckOut.getTime() - expectedCheckIn.getTime()) / (24 * 3600 * 1000)));
    const subtotal = dto.subtotal ?? nights * Number(dto.ratePerNight);
    const discountAmount = dto.discountAmount ?? 0;
    const taxAmount = dto.taxAmount ?? 0;
    const totalAmount = dto.totalAmount ?? Math.max(0, subtotal - discountAmount + taxAmount);
    const paidAmount = dto.paidAmount ?? 0;
    const booking = await this.prisma.roomBooking.create({
      data: {
        ...dto,
        bookingDate: dto.bookingDate ? new Date(dto.bookingDate) : new Date(),
        expectedCheckIn,
        expectedCheckOut,
        nights,
        subtotal,
        discountAmount,
        taxAmount,
        totalAmount,
        paidAmount,
        outstandingAmount: dto.outstandingAmount ?? Math.max(0, totalAmount - paidAmount),
        createdById: user.id,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'RoomBooking',
      entityId: booking.id,
      companyId: booking.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return booking;
  }

  async findAll(
    companyId: string | undefined,
    hospitalityFacilityId: string | undefined,
    guestId: string | undefined,
    roomId: string | undefined,
    status: RoomBookingStatus | undefined,
    page = 1,
    limit = 20,
    user: AuthUser,
  ) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (hospitalityFacilityId) where.hospitalityFacilityId = hospitalityFacilityId;
    if (guestId) where.guestId = guestId;
    if (roomId) where.roomId = roomId;
    if (status) where.status = status;
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const [data, total] = await Promise.all([
      this.prisma.roomBooking.findMany({
        where,
        include: {
          facility: { select: { facilityName: true, facilityCode: true } },
          room: { select: { roomNumber: true, roomType: true } },
          guest: { select: { fullName: true, guestCode: true } },
        },
        orderBy: { expectedCheckIn: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.roomBooking.count({ where }),
    ]);
    return { data, total, page: safePage, limit: safeLimit };
  }

  async findOne(id: string, user: AuthUser) {
    const where: any = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const booking = await this.prisma.roomBooking.findFirst({
      where,
      include: {
        facility: true,
        room: true,
        guest: true,
        payments: true,
        folio: { include: { charges: true } },
      },
    });
    if (!booking) throw new NotFoundException('Room booking not found');
    return booking;
  }

  async update(id: string, dto: UpdateRoomBookingDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    const roomId = dto.roomId ?? existing.roomId;
    const expectedCheckIn = dto.expectedCheckIn ? new Date(dto.expectedCheckIn) : existing.expectedCheckIn;
    const expectedCheckOut = dto.expectedCheckOut ? new Date(dto.expectedCheckOut) : existing.expectedCheckOut;
    if (expectedCheckOut <= expectedCheckIn) {
      throw new BadRequestException('Expected check-out must be after check-in');
    }
    await this.assertNoConflict(existing.companyId, roomId, expectedCheckIn, expectedCheckOut, id);
    const updated = await this.prisma.roomBooking.update({
      where: { id },
      data: {
        ...dto,
        bookingDate: dto.bookingDate ? new Date(dto.bookingDate) : undefined,
        expectedCheckIn,
        expectedCheckOut,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'RoomBooking',
      entityId: id,
      companyId: updated.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async checkIn(id: string, user: AuthUser) {
    const booking = await this.findOne(id, user);
    if (booking.status !== RoomBookingStatus.RESERVED) {
      throw new BadRequestException('Only RESERVED bookings can be checked in');
    }
    const updated = await this.prisma.roomBooking.update({
      where: { id },
      data: { status: RoomBookingStatus.CHECKED_IN, actualCheckIn: new Date(), checkedInById: user.id },
    });
    await this.folios.openForBooking(id, user.id);
    await this.audit.log({
      userId: user.id,
      action: 'CHECK_IN',
      entityType: 'RoomBooking',
      entityId: id,
      companyId: updated.companyId,
      newValue: { status: updated.status } as unknown as Record<string, unknown>,
    });
    return this.findOne(id, user);
  }

  async checkOut(id: string, user: AuthUser) {
    const booking = await this.findOne(id, user);
    if (booking.status !== RoomBookingStatus.CHECKED_IN) {
      throw new BadRequestException('Only CHECKED_IN bookings can be checked out');
    }
    const updated = await this.prisma.roomBooking.update({
      where: { id },
      data: { status: RoomBookingStatus.CHECKED_OUT, actualCheckOut: new Date(), checkedOutById: user.id },
    });
    const folio = await this.folios.openForBooking(id, user.id);
    await this.folios.postRoomNightsCharge(folio.id, user.id);
    await this.audit.log({
      userId: user.id,
      action: 'CHECK_OUT',
      entityType: 'RoomBooking',
      entityId: id,
      companyId: updated.companyId,
      newValue: { status: updated.status } as unknown as Record<string, unknown>,
    });
    return this.findOne(id, user);
  }

  async cancel(id: string, user: AuthUser) {
    const booking = await this.findOne(id, user);
    if (booking.status === RoomBookingStatus.CHECKED_OUT) {
      throw new BadRequestException('Checked-out bookings cannot be cancelled');
    }
    const updated = await this.prisma.roomBooking.update({
      where: { id },
      data: { status: RoomBookingStatus.CANCELLED },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CANCEL',
      entityType: 'RoomBooking',
      entityId: id,
      companyId: updated.companyId,
      newValue: { status: updated.status } as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user);
    return this.prisma.roomBooking.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
