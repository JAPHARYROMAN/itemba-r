import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { MenuItemType } from '@prisma/client';

@Injectable()
export class MenuItemsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateMenuItemDto, userId: string) {
    const existing = await this.prisma.menuItem.findFirst({
      where: { companyId: dto.companyId, menuItemCode: dto.menuItemCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Menu item code already exists for this company');
    const item = await this.prisma.menuItem.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'MenuItem', entityId: item.id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async findAll(companyId?: string, hospitalityFacilityId?: string, menuCategoryId?: string, isActive?: boolean, itemType?: MenuItemType, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (hospitalityFacilityId) where.hospitalityFacilityId = hospitalityFacilityId;
    if (menuCategoryId) where.menuCategoryId = menuCategoryId;
    if (isActive !== undefined) where.isActive = isActive;
    if (itemType) where.itemType = itemType;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.menuItem.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
        include: { category: { select: { name: true, categoryType: true } } },
      }),
      this.prisma.menuItem.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, deletedAt: null },
      include: { category: { select: { name: true, categoryType: true } } },
    });
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async update(id: string, dto: UpdateMenuItemDto, userId: string) {
    await this.findOne(id);
    const item = await this.prisma.menuItem.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'MenuItem', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return item;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.menuItem.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'MenuItem', entityId: id, newValue: {} });
    return { message: 'Menu item deleted' };
  }
}
