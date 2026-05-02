import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ParkingFacilitiesService } from './parking-facilities.service';
import { CreateParkingFacilityDto } from './dto/create-parking-facility.dto';
import { UpdateParkingFacilityDto } from './dto/update-parking-facility.dto';
import { ParkingFacilityStatus } from '@prisma/client';

@Controller('parking-facilities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ParkingFacilitiesController {
  constructor(private service: ParkingFacilitiesService) {}

  @Post()
  @RequirePermissions('parking_facilities.manage')
  create(@Body() dto: CreateParkingFacilityDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('parking_facilities.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('divisionId') divisionId?: string,
    @Query('status') status?: ParkingFacilityStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(companyId, divisionId, status, search, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('parking_facilities.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('parking_facilities.manage')
  update(@Param('id') id: string, @Body() dto: UpdateParkingFacilityDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('parking_facilities.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
