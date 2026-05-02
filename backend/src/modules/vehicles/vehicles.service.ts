import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateVehicleDto, userId: string) {
    const existing = await this.prisma.vehicle.findFirst({ where: { companyId: dto.companyId, vehicleCode: dto.vehicleCode, deletedAt: null } });
    if (existing) throw new BadRequestException('Vehicle code already exists for this company');
    const regExisting = await this.prisma.vehicle.findFirst({ where: { companyId: dto.companyId, registrationNumber: dto.registrationNumber, deletedAt: null } });
    if (regExisting) throw new BadRequestException('Registration number already exists for this company');
    const vehicle = await this.prisma.vehicle.create({
      data: {
        ...dto,
        insuranceExpiryDate: dto.insuranceExpiryDate ? new Date(dto.insuranceExpiryDate) : undefined,
        roadLicenseExpiryDate: dto.roadLicenseExpiryDate ? new Date(dto.roadLicenseExpiryDate) : undefined,
        inspectionExpiryDate: dto.inspectionExpiryDate ? new Date(dto.inspectionExpiryDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'Vehicle', entityId: vehicle.id, newValue: dto as unknown as Record<string, unknown> });
    return vehicle;
  }

  async findAll(companyId?: string, status?: VehicleStatus, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { company: { select: { name: true } }, division: { select: { name: true } }, assignedDriver: { select: { fullName: true } } } }),
      this.prisma.vehicle.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, deletedAt: null }, include: { company: { select: { name: true } }, division: { select: { name: true } }, assignedDriver: { select: { fullName: true, driverCode: true } }, fixedAsset: { select: { name: true, assetCode: true } } } });
    if (!v) throw new NotFoundException('Vehicle not found');
    return v;
  }

  async update(id: string, dto: UpdateVehicleDto, userId: string) {
    await this.findOne(id);
    const vehicle = await this.prisma.vehicle.update({
      where: { id },
      data: {
        ...dto,
        insuranceExpiryDate: dto.insuranceExpiryDate ? new Date(dto.insuranceExpiryDate) : undefined,
        roadLicenseExpiryDate: dto.roadLicenseExpiryDate ? new Date(dto.roadLicenseExpiryDate) : undefined,
        inspectionExpiryDate: dto.inspectionExpiryDate ? new Date(dto.inspectionExpiryDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'Vehicle', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return vehicle;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'Vehicle', entityId: id, newValue: {} });
    return { message: 'Vehicle deleted' };
  }
}
