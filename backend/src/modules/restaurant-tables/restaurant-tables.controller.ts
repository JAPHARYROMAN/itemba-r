import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RestaurantTablesService } from './restaurant-tables.service';
import { CreateRestaurantTableDto } from './dto/create-restaurant-table.dto';
import { UpdateRestaurantTableDto } from './dto/update-restaurant-table.dto';
import { RestaurantTableStatus } from '@prisma/client';

@Controller('restaurant-tables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RestaurantTablesController {
  constructor(private service: RestaurantTablesService) {}

  @Post()
  @RequirePermissions('restaurant_tables.manage')
  create(@Body() dto: CreateRestaurantTableDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('restaurant_tables.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('hospitalityFacilityId') hospitalityFacilityId?: string,
    @Query('status') status?: RestaurantTableStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(companyId, hospitalityFacilityId, status, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('restaurant_tables.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('restaurant_tables.manage')
  update(@Param('id') id: string, @Body() dto: UpdateRestaurantTableDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('restaurant_tables.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
