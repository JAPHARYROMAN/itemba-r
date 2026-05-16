import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { InventoryLocationsService } from './inventory-locations.service';
import { CreateInventoryLocationDto } from './dto/create-inventory-location.dto';
import { UpdateInventoryLocationDto } from './dto/update-inventory-location.dto';
import { QueryInventoryLocationDto } from './dto/query-inventory-location.dto';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('inventory-locations')
export class InventoryLocationsController {
  constructor(private readonly service: InventoryLocationsService) {}

  @Get()
  @RequireAnyPermissions(
    'inventory.view',
    'inventory_locations.view',
    'purchases.create',
    'sales.create',
  )
  findAll(@Query() query: QueryInventoryLocationDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequireAnyPermissions('inventory.view', 'inventory_locations.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequireAnyPermissions('inventory.manage', 'inventory_locations.manage')
  create(@Body() dto: CreateInventoryLocationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequireAnyPermissions('inventory.manage', 'inventory_locations.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryLocationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequireAnyPermissions('inventory.manage', 'inventory_locations.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
