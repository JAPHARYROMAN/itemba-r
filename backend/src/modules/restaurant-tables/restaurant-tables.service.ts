import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRestaurantTableDto } from './dto/create-restaurant-table.dto';
import { UpdateRestaurantTableDto } from './dto/update-restaurant-table.dto';
import { RestaurantTableStatus } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class RestaurantTablesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateRestaurantTableDto, userId: string) {
    const existing = await this.prisma.restaurantTable.findFirst({
      where: { companyId: dto.companyId, tableCode: dto.tableCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Table code already exists for this company');
    const table = await this.prisma.restaurantTable.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'RestaurantTable', entityId: table.id, newValue: dto as unknown as Record<string, unknown> });
    return table;
  }

  async findAll(companyId?: string, hospitalityFacilityId?: string, status?: RestaurantTableStatus, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (hospitalityFacilityId) where.hospitalityFacilityId = hospitalityFacilityId;
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.restaurantTable.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
        include: { facility: { select: { facilityName: true } } },
      }),
      this.prisma.restaurantTable.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id, deletedAt: null },
      include: { facility: { select: { facilityName: true, facilityCode: true } } },
    });
    if (!table) throw new NotFoundException('Restaurant table not found');
    return table;
  }

  async update(id: string, dto: UpdateRestaurantTableDto, userId: string) {
    await this.findOne(id);
    const table = await this.prisma.restaurantTable.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'RestaurantTable', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return table;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.restaurantTable.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'RestaurantTable', entityId: id, newValue: {} });
    return { message: 'Restaurant table deleted' };
  }
}
