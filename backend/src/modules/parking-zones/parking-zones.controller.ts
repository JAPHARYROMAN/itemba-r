import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ParkingZonesService } from './parking-zones.service';
import { CreateParkingZoneDto } from './dto/create-parking-zone.dto';
import { UpdateParkingZoneDto } from './dto/update-parking-zone.dto';
import { ParkingZoneStatus, ParkingZoneVehicleType } from '@prisma/client';

@Controller('parking-zones')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ParkingZonesController {
  constructor(private service: ParkingZonesService) {}

  @Post()
  @RequirePermissions('parking_zones.manage')
  create(@Body() dto: CreateParkingZoneDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('parking_zones.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('facilityId') facilityId?: string,
    @Query('status') status?: ParkingZoneStatus,
    @Query('vehicleType') vehicleType?: ParkingZoneVehicleType,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(companyId, facilityId, status, vehicleType, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('parking_zones.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('parking_zones.manage')
  update(@Param('id') id: string, @Body() dto: UpdateParkingZoneDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('parking_zones.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
