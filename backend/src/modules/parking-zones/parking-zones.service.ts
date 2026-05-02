import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateParkingZoneDto } from './dto/create-parking-zone.dto';
import { UpdateParkingZoneDto } from './dto/update-parking-zone.dto';
import { ParkingZoneStatus, ParkingZoneVehicleType } from '@prisma/client';

@Injectable()
export class ParkingZonesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateParkingZoneDto, userId: string) {
    const existing = await this.prisma.parkingZone.findFirst({
      where: { facilityId: dto.facilityId, zoneCode: dto.zoneCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Zone code already exists for this facility');

    const zone = await this.prisma.parkingZone.create({ data: dto });
    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'ParkingZone',
      entityId: zone.id,
      companyId: dto.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return zone;
  }

  async findAll(
    companyId?: string,
    facilityId?: string,
    status?: ParkingZoneStatus,
    vehicleType?: ParkingZoneVehicleType,
    page = 1,
    limit = 20,
  ) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (facilityId) where.facilityId = facilityId;
    if (status) where.status = status;
    if (vehicleType) where.vehicleType = vehicleType;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.parkingZone.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { name: true } },
          facility: { select: { facilityName: true } },
        },
      }),
      this.prisma.parkingZone.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const zone = await this.prisma.parkingZone.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { name: true } },
        facility: { select: { facilityName: true, facilityCode: true } },
      },
    });
    if (!zone) throw new NotFoundException('Parking zone not found');
    return zone;
  }

  async update(id: string, dto: UpdateParkingZoneDto, userId: string) {
    const zone = await this.findOne(id);
    const updated = await this.prisma.parkingZone.update({ where: { id }, data: dto });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entityType: 'ParkingZone',
      entityId: id,
      companyId: zone.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async remove(id: string, userId: string) {
    const zone = await this.findOne(id);
    await this.prisma.parkingZone.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId,
      action: 'DELETE',
      entityType: 'ParkingZone',
      entityId: id,
      companyId: zone.companyId,
      newValue: {},
    });
    return { message: 'Parking zone deleted' };
  }
}
