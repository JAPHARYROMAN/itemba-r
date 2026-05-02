import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { MenuItemsService } from './menu-items.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { MenuItemType } from '@prisma/client';

@Controller('menu-items')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MenuItemsController {
  constructor(private service: MenuItemsService) {}

  @Post()
  @RequirePermissions('menu_items.manage')
  create(@Body() dto: CreateMenuItemDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('menu_items.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('hospitalityFacilityId') hospitalityFacilityId?: string,
    @Query('menuCategoryId') menuCategoryId?: string,
    @Query('isActive') isActive?: string,
    @Query('itemType') itemType?: MenuItemType,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const isActiveBool = isActive !== undefined ? isActive === 'true' : undefined;
    return this.service.findAll(companyId, hospitalityFacilityId, menuCategoryId, isActiveBool, itemType, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('menu_items.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('menu_items.manage')
  update(@Param('id') id: string, @Body() dto: UpdateMenuItemDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('menu_items.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
