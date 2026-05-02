import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomStatus, RoomType } from '@prisma/client';

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateRoomDto, userId: string) {
    const existing = await this.prisma.room.findFirst({
      where: { hospitalityFacilityId: dto.hospitalityFacilityId, roomCode: dto.roomCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Room code already exists for this facility');
    const room = await this.prisma.room.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'Room', entityId: room.id, newValue: dto as unknown as Record<string, unknown> });
    return room;
  }

  async findAll(companyId?: string, hospitalityFacilityId?: string, status?: RoomStatus, roomType?: RoomType, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (hospitalityFacilityId) where.hospitalityFacilityId = hospitalityFacilityId;
    if (status) where.status = status;
    if (roomType) where.roomType = roomType;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.room.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { facility: { select: { facilityName: true } } } }),
      this.prisma.room.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const room = await this.prisma.room.findFirst({ where: { id, deletedAt: null }, include: { facility: { select: { facilityName: true, facilityCode: true } } } });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  async update(id: string, dto: UpdateRoomDto, userId: string) {
    await this.findOne(id);
    const room = await this.prisma.room.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'Room', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return room;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.room.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'Room', entityId: id, newValue: {} });
    return { message: 'Room deleted' };
  }
}
