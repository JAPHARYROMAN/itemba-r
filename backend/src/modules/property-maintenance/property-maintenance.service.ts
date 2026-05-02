import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreatePropertyMaintenanceDto } from './dto/create-property-maintenance.dto';
import { UpdatePropertyMaintenanceDto } from './dto/update-property-maintenance.dto';

@Injectable()
export class PropertyMaintenanceService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreatePropertyMaintenanceDto, userId: string) {
    const item = await this.prisma.propertyMaintenance.create({
      data: { ...dto, maintenanceDate: new Date(dto.maintenanceDate) },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'PropertyMaintenance', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(companyId?: string, propertyId?: string, rentalUnitId?: string, status?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (propertyId) where.propertyId = propertyId;
    if (rentalUnitId) where.rentalUnitId = rentalUnitId;
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.propertyMaintenance.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.propertyMaintenance.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.propertyMaintenance.findFirst({
      where: { id, deletedAt: null },
      include: {
        property: { select: { propertyName: true } },
        rentalUnit: { select: { unitNumber: true } },
      },
    });
    if (!item) throw new NotFoundException('PropertyMaintenance not found');
    return item;
  }

  async update(id: string, dto: UpdatePropertyMaintenanceDto, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.propertyMaintenance.update({
      where: { id },
      data: {
        ...dto,
        maintenanceDate: dto.maintenanceDate ? new Date(dto.maintenanceDate) : undefined,
      },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'PropertyMaintenance', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.propertyMaintenance.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'PropertyMaintenance', entityId: id, newValue: {} });
    return { message: 'PropertyMaintenance deleted' };
  }
}
