import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateVehicleMaintenanceDto } from './dto/create-vehicle-maintenance.dto';
import { UpdateVehicleMaintenanceDto } from './dto/update-vehicle-maintenance.dto';
import { MaintenanceStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class VehicleMaintenanceService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  private async nextNumber(companyId: string) {
    const year = new Date().getFullYear();
    const count = await this.prisma.vehicleMaintenance.count({ where: { companyId } });
    return `MAINT-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateVehicleMaintenanceDto, userId: string) {
    const maintenanceNumber = await this.nextNumber(dto.companyId);
    const record = await this.prisma.vehicleMaintenance.create({
      data: { ...dto, maintenanceNumber, maintenanceDate: new Date(dto.maintenanceDate), nextServiceDate: dto.nextServiceDate ? new Date(dto.nextServiceDate) : undefined, createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'VehicleMaintenance', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async findAll(companyId?: string, vehicleId?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (vehicleId) where.vehicleId = vehicleId;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehicleMaintenance.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { maintenanceDate: 'desc' }, include: { vehicle: { select: { vehicleCode: true, registrationNumber: true } } } }),
      this.prisma.vehicleMaintenance.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const r = await this.prisma.vehicleMaintenance.findFirst({ where: { id, deletedAt: null }, include: { vehicle: { select: { vehicleCode: true, registrationNumber: true, make: true, model: true } } } });
    if (!r) throw new NotFoundException('Maintenance record not found');
    return r;
  }

  async complete(id: string, userId: string) {
    await this.findOne(id);
    const updated = await this.prisma.vehicleMaintenance.update({ where: { id }, data: { status: MaintenanceStatus.COMPLETED } });
    await this.audit.log({ userId, action: 'COMPLETE', entityType: 'VehicleMaintenance', entityId: id, newValue: {} });
    return updated;
  }

  async update(id: string, dto: UpdateVehicleMaintenanceDto, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.vehicleMaintenance.update({ where: { id }, data: { ...dto, maintenanceDate: dto.maintenanceDate ? new Date(dto.maintenanceDate) : undefined, nextServiceDate: dto.nextServiceDate ? new Date(dto.nextServiceDate) : undefined } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'VehicleMaintenance', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.vehicleMaintenance.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'VehicleMaintenance', entityId: id, newValue: {} });
    return { message: 'Maintenance record deleted' };
  }
}
