import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRentalPropertyDto } from './dto/create-rental-property.dto';
import { UpdateRentalPropertyDto } from './dto/update-rental-property.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class RentalPropertiesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateRentalPropertyDto, userId: string) {
    const item = await this.prisma.rentalProperty.create({ data: { ...dto } });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'RentalProperty', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(companyId?: string, divisionId?: string, status?: string, propertyType?: string, search?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (status) where.status = status;
    if (propertyType) where.propertyType = propertyType;
    if (search) {
      where.OR = [
        { propertyName: { contains: search, mode: 'insensitive' } },
        { propertyCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.rentalProperty.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.rentalProperty.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.rentalProperty.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { name: true } },
        division: { select: { name: true } },
      },
    });
    if (!item) throw new NotFoundException('RentalProperty not found');
    return item;
  }

  async update(id: string, dto: UpdateRentalPropertyDto, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.rentalProperty.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'RentalProperty', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.rentalProperty.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'RentalProperty', entityId: id, newValue: {} });
    return { message: 'RentalProperty deleted' };
  }
}
