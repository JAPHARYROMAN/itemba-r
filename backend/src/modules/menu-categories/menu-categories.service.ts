import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { MenuCategoryType } from '@prisma/client';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class MenuCategoriesService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateMenuCategoryDto, userId: string) {
    const category = await this.prisma.menuCategory.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'MenuCategory', entityId: category.id, newValue: dto as unknown as Record<string, unknown> });
    return category;
  }

  async findAll(companyId?: string, hospitalityFacilityId?: string, categoryType?: MenuCategoryType, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (hospitalityFacilityId) where.hospitalityFacilityId = hospitalityFacilityId;
    if (categoryType) where.categoryType = categoryType;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.menuCategory.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.menuCategory.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const category = await this.prisma.menuCategory.findFirst({ where: { id, deletedAt: null } });
    if (!category) throw new NotFoundException('Menu category not found');
    return category;
  }

  async update(id: string, dto: UpdateMenuCategoryDto, userId: string) {
    await this.findOne(id);
    const category = await this.prisma.menuCategory.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'MenuCategory', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return category;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.menuCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'MenuCategory', entityId: id, newValue: {} });
    return { message: 'Menu category deleted' };
  }
}
