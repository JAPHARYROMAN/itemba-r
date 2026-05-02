import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateParkingRateDto } from './dto/create-parking-rate.dto';
import { UpdateParkingRateDto } from './dto/update-parking-rate.dto';
import { ParkingRateStatus, ParkingRateType } from '@prisma/client';

@Injectable()
export class ParkingRatesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateParkingRateDto, userId: string) {
    const existing = await this.prisma.parkingRate.findFirst({
      where: { companyId: dto.companyId, rateCode: dto.rateCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Rate code already exists for this company');

    const rate = await this.prisma.parkingRate.create({
      data: {
        ...dto,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      },
    });
    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'ParkingRate',
      entityId: rate.id,
      companyId: dto.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return rate;
  }

  async findAll(
    companyId?: string,
    facilityId?: string,
    zoneId?: string,
    status?: ParkingRateStatus,
    rateType?: ParkingRateType,
    page = 1,
    limit = 20,
  ) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (facilityId) where.facilityId = facilityId;
    if (zoneId) where.zoneId = zoneId;
    if (status) where.status = status;
    if (rateType) where.rateType = rateType;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.parkingRate.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { name: true } },
          facility: { select: { facilityName: true } },
          zone: { select: { zoneName: true } },
          createdBy: { select: { fullName: true } },
          approvedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.parkingRate.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const rate = await this.prisma.parkingRate.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { name: true } },
        facility: { select: { facilityName: true } },
        zone: { select: { zoneName: true } },
        createdBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
    });
    if (!rate) throw new NotFoundException('Parking rate not found');
    return rate;
  }

  async update(id: string, dto: UpdateParkingRateDto, userId: string) {
    const rate = await this.findOne(id);
    const updated = await this.prisma.parkingRate.update({
      where: { id },
      data: {
        ...dto,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      },
    });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entityType: 'ParkingRate',
      entityId: id,
      companyId: rate.companyId,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async approve(id: string, userId: string) {
    const rate = await this.findOne(id);
    if (rate.status === ParkingRateStatus.ACTIVE) {
      throw new BadRequestException('Parking rate is already active');
    }
    const updated = await this.prisma.parkingRate.update({
      where: { id },
      data: {
        status: ParkingRateStatus.ACTIVE,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
    await this.audit.log({
      userId,
      action: 'APPROVE',
      entityType: 'ParkingRate',
      entityId: id,
      companyId: rate.companyId,
      newValue: { status: ParkingRateStatus.ACTIVE },
    });
    return updated;
  }

  async remove(id: string, userId: string) {
    const rate = await this.findOne(id);
    await this.prisma.parkingRate.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId,
      action: 'DELETE',
      entityType: 'ParkingRate',
      entityId: id,
      companyId: rate.companyId,
      newValue: {},
    });
    return { message: 'Parking rate deleted' };
  }
}
