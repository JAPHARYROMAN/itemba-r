import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ParkingRatesService } from './parking-rates.service';
import { CreateParkingRateDto } from './dto/create-parking-rate.dto';
import { UpdateParkingRateDto } from './dto/update-parking-rate.dto';
import { ParkingRateStatus, ParkingRateType } from '@prisma/client';

@Controller('parking-rates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ParkingRatesController {
  constructor(private service: ParkingRatesService) {}

  @Post()
  @RequirePermissions('parking_rates.manage')
  create(@Body() dto: CreateParkingRateDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('parking_rates.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('facilityId') facilityId?: string,
    @Query('zoneId') zoneId?: string,
    @Query('status') status?: ParkingRateStatus,
    @Query('rateType') rateType?: ParkingRateType,
    @Query('page') page?: string,
    @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(companyId, facilityId, zoneId, status, rateType, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('parking_rates.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('parking_rates.manage')
  update(@Param('id') id: string, @Body() dto: UpdateParkingRateDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/approve')
  @RequirePermissions('parking_rates.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('parking_rates.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
