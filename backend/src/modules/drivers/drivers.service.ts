import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class DriversService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateDriverDto, userId: string) {
    const existing = await this.prisma.driverProfile.findFirst({ where: { companyId: dto.companyId, driverCode: dto.driverCode, deletedAt: null } });
    if (existing) throw new BadRequestException('Driver code already exists');
    const driver = await this.prisma.driverProfile.create({
      data: { ...dto, licenseExpiryDate: dto.licenseExpiryDate ? new Date(dto.licenseExpiryDate) : undefined },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'DriverProfile', entityId: driver.id, newValue: dto as unknown as Record<string, unknown> });
    return driver;
  }

  async findAll(companyId?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.driverProfile.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { assignedVehicle: { select: { vehicleCode: true, registrationNumber: true } } } }),
      this.prisma.driverProfile.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const d = await this.prisma.driverProfile.findFirst({ where: { id, deletedAt: null }, include: { assignedVehicle: { select: { vehicleCode: true, registrationNumber: true, make: true, model: true } }, company: { select: { name: true } }, division: { select: { name: true } } } });
    if (!d) throw new NotFoundException('Driver not found');
    return d;
  }

  async update(id: string, dto: UpdateDriverDto, userId: string) {
    await this.findOne(id);
    const driver = await this.prisma.driverProfile.update({
      where: { id },
      data: { ...dto, licenseExpiryDate: dto.licenseExpiryDate ? new Date(dto.licenseExpiryDate) : undefined },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'DriverProfile', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return driver;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.driverProfile.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'DriverProfile', entityId: id, newValue: {} });
    return { message: 'Driver deleted' };
  }
}
