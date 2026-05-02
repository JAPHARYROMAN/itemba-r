import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRentalUnitDto } from './dto/create-rental-unit.dto';
import { UpdateRentalUnitDto } from './dto/update-rental-unit.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class RentalUnitsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateRentalUnitDto, userId: string) {
    const item = await this.prisma.rentalUnit.create({ data: { ...dto } });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'RentalUnit', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(companyId?: string, propertyId?: string, status?: string, unitType?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (unitType) where.unitType = unitType;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.rentalUnit.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.rentalUnit.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.rentalUnit.findFirst({
      where: { id, deletedAt: null },
      include: {
        property: { select: { propertyName: true, propertyCode: true } },
        company: { select: { name: true } },
      },
    });
    if (!item) throw new NotFoundException('RentalUnit not found');
    return item;
  }

  async update(id: string, dto: UpdateRentalUnitDto, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.rentalUnit.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'RentalUnit', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.rentalUnit.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'RentalUnit', entityId: id, newValue: {} });
    return { message: 'RentalUnit deleted' };
  }
}
