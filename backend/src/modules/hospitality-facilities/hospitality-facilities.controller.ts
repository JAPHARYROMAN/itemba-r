import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { HospitalityFacilitiesService } from './hospitality-facilities.service';
import { CreateHospitalityFacilityDto } from './dto/create-hospitality-facility.dto';
import { UpdateHospitalityFacilityDto } from './dto/update-hospitality-facility.dto';
import { HospitalityFacilityStatus } from '@prisma/client';

@Controller('hospitality-facilities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HospitalityFacilitiesController {
  constructor(private service: HospitalityFacilitiesService) {}

  @Post()
  @RequirePermissions('hospitality_facilities.manage')
  create(@Body() dto: CreateHospitalityFacilityDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('hospitality_facilities.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('divisionId') divisionId?: string,
    @Query('status') status?: HospitalityFacilityStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(companyId, divisionId, status, search, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('hospitality_facilities.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('hospitality_facilities.manage')
  update(@Param('id') id: string, @Body() dto: UpdateHospitalityFacilityDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('hospitality_facilities.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
