import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateParkingFacilityDto } from './dto/create-parking-facility.dto';
import { UpdateParkingFacilityDto } from './dto/update-parking-facility.dto';
import { ParkingFacilityStatus } from '@prisma/client';

@Injectable()
export class ParkingFacilitiesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateParkingFacilityDto, userId: string) {
    const existing = await this.prisma.parkingFacility.findFirst({
      where: { companyId: dto.companyId, facilityCode: dto.facilityCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Facility code already exists for this company');

    const facility = await this.prisma.parkingFacility.create({ data: dto });
    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'ParkingFacility',
      entityId: facility.id,
      companyId: dto.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return facility;
  }

  async findAll(
    companyId?: string,
    divisionId?: string,
    status?: ParkingFacilityStatus,
    search?: string,
    page = 1,
    limit = 20,
  ) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (divisionId) where.divisionId = divisionId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { facilityName: { contains: search, mode: 'insensitive' } },
        { facilityCode: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.parkingFacility.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { name: true } },
          division: { select: { name: true } },
          manager: { select: { fullName: true } },
        },
      }),
      this.prisma.parkingFacility.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const facility = await this.prisma.parkingFacility.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { name: true } },
        division: { select: { name: true } },
        branch: { select: { name: true } },
        manager: { select: { fullName: true } },
      },
    });
    if (!facility) throw new NotFoundException('Parking facility not found');
    return facility;
  }

  async update(id: string, dto: UpdateParkingFacilityDto, userId: string) {
    const facility = await this.findOne(id);
    const updated = await this.prisma.parkingFacility.update({ where: { id }, data: dto });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entityType: 'ParkingFacility',
      entityId: id,
      companyId: facility.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async remove(id: string, userId: string) {
    const facility = await this.findOne(id);
    await this.prisma.parkingFacility.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId,
      action: 'DELETE',
      entityType: 'ParkingFacility',
      entityId: id,
      companyId: facility.companyId,
      newValue: {},
    });
    return { message: 'Parking facility deleted' };
  }
}
