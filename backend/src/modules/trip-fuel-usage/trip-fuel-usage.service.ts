import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateTripFuelUsageDto } from './dto/create-trip-fuel-usage.dto';
import { UpdateTripFuelUsageDto } from './dto/update-trip-fuel-usage.dto';

@Injectable()
export class TripFuelUsageService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateTripFuelUsageDto, userId: string) {
    const fuel = await this.prisma.tripFuelUsage.create({
      data: { ...dto, fuelDate: new Date(dto.fuelDate), createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'TripFuelUsage', entityId: fuel.id, newValue: dto as unknown as Record<string, unknown> });
    return fuel;
  }

  async findByTrip(tripId: string) {
    return this.prisma.tripFuelUsage.findMany({ where: { tripId, deletedAt: null }, orderBy: { fuelDate: 'desc' } });
  }

  async findAll(companyId?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.tripFuelUsage.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { fuelDate: 'desc' } }),
      this.prisma.tripFuelUsage.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const f = await this.prisma.tripFuelUsage.findFirst({ where: { id, deletedAt: null } });
    if (!f) throw new NotFoundException('Trip fuel usage not found');
    return f;
  }

  async update(id: string, dto: UpdateTripFuelUsageDto, userId: string) {
    await this.findOne(id);
    const fuel = await this.prisma.tripFuelUsage.update({ where: { id }, data: { ...dto, fuelDate: dto.fuelDate ? new Date(dto.fuelDate) : undefined } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'TripFuelUsage', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return fuel;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.tripFuelUsage.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'TripFuelUsage', entityId: id, newValue: {} });
    return { message: 'Fuel usage deleted' };
  }
}
