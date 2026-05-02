import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TripFuelUsageService } from './trip-fuel-usage.service';
import { CreateTripFuelUsageDto } from './dto/create-trip-fuel-usage.dto';
import { UpdateTripFuelUsageDto } from './dto/update-trip-fuel-usage.dto';

@Controller('logistics/trip-fuel-usage')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TripFuelUsageController {
  constructor(private service: TripFuelUsageService) {}

  @Post() @RequirePermissions('trip_fuel_usage.manage')
  create(@Body() dto: CreateTripFuelUsageDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('trip_fuel_usage.view')
  findAll(@Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser) {
    return this.service.findAll(companyId, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get('by-trip/:tripId') @RequirePermissions('trip_fuel_usage.view')
  findByTrip(@Param('tripId') tripId: string) { return this.service.findByTrip(tripId); }

  @Get(':id') @RequirePermissions('trip_fuel_usage.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Put(':id') @RequirePermissions('trip_fuel_usage.manage')
  update(@Param('id') id: string, @Body() dto: UpdateTripFuelUsageDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('trip_fuel_usage.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
