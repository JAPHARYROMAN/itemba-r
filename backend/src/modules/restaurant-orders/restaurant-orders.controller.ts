import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RestaurantOrdersService } from './restaurant-orders.service';
import { CreateRestaurantOrderDto } from './dto/create-restaurant-order.dto';
import { UpdateRestaurantOrderDto } from './dto/update-restaurant-order.dto';
import { RestaurantOrderStatus, RestaurantOrderType } from '@prisma/client';

@Controller('restaurant-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RestaurantOrdersController {
  constructor(private service: RestaurantOrdersService) {}

  @Post()
  @RequirePermissions('restaurant_orders.create')
  create(@Body() dto: CreateRestaurantOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('restaurant_orders.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('hospitalityFacilityId') hospitalityFacilityId?: string,
    @Query('tableId') tableId?: string,
    @Query('guestId') guestId?: string,
    @Query('status') status?: RestaurantOrderStatus,
    @Query('orderType') orderType?: RestaurantOrderType,
    @Query('page') page?: string,
    @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(companyId, hospitalityFacilityId, tableId, guestId, status, orderType, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('restaurant_orders.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('restaurant_orders.create')
  update(@Param('id') id: string, @Body() dto: UpdateRestaurantOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/complete')
  @RequirePermissions('restaurant_orders.complete')
  complete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.complete(id, user.id);
  }

  @Post(':id/void')
  @RequirePermissions('restaurant_orders.void')
  void(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.void(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('restaurant_orders.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
