import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PropertyMaintenanceService } from './property-maintenance.service';
import { CreatePropertyMaintenanceDto } from './dto/create-property-maintenance.dto';
import { UpdatePropertyMaintenanceDto } from './dto/update-property-maintenance.dto';

@Controller('property-maintenance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PropertyMaintenanceController {
  constructor(private service: PropertyMaintenanceService) {}

  @Get()
  @RequirePermissions('property_maintenance.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('propertyId') propertyId?: string,
    @Query('rentalUnitId') rentalUnitId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(companyId, propertyId, rentalUnitId, status, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('property_maintenance.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('property_maintenance.manage')
  create(@Body() dto: CreatePropertyMaintenanceDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('property_maintenance.manage')
  update(@Param('id') id: string, @Body() dto: UpdatePropertyMaintenanceDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('property_maintenance.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
