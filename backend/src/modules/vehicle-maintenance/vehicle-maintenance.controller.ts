import { Controller, Get, Post, Put, Delete, Body, Param, Query, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';
import { CreateVehicleMaintenanceDto } from './dto/create-vehicle-maintenance.dto';
import { UpdateVehicleMaintenanceDto } from './dto/update-vehicle-maintenance.dto';

@Controller('logistics/vehicle-maintenance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VehicleMaintenanceController {
  constructor(private service: VehicleMaintenanceService) {}

  @Post() @RequirePermissions('vehicle_maintenance.manage')
  create(@Body() dto: CreateVehicleMaintenanceDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('vehicle_maintenance.view')
  findAll(@Query('companyId') companyId?: string, @Query('vehicleId') vehicleId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(companyId, vehicleId, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id') @RequirePermissions('vehicle_maintenance.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Patch(':id/complete') @RequirePermissions('vehicle_maintenance.manage')
  complete(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.complete(id, user.id); }

  @Put(':id') @RequirePermissions('vehicle_maintenance.manage')
  update(@Param('id') id: string, @Body() dto: UpdateVehicleMaintenanceDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('vehicle_maintenance.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
