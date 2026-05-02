import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { MenuCategoriesService } from './menu-categories.service';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { MenuCategoryType } from '@prisma/client';

@Controller('menu-categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MenuCategoriesController {
  constructor(private service: MenuCategoriesService) {}

  @Post()
  @RequirePermissions('menu_categories.manage')
  create(@Body() dto: CreateMenuCategoryDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('menu_categories.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('hospitalityFacilityId') hospitalityFacilityId?: string,
    @Query('categoryType') categoryType?: MenuCategoryType,
    @Query('page') page?: string,
    @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(companyId, hospitalityFacilityId, categoryType, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('menu_categories.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('menu_categories.manage')
  update(@Param('id') id: string, @Body() dto: UpdateMenuCategoryDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('menu_categories.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
