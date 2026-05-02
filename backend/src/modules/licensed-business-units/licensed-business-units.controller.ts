import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LicensedBusinessUnitsService } from './licensed-business-units.service';
import { CreateLicensedBusinessUnitDto } from './dto/create-licensed-business-unit.dto';
import { UpdateLicensedBusinessUnitDto } from './dto/update-licensed-business-unit.dto';
import { BusinessUnitStatus } from '@prisma/client';

@Controller('licensed-business-units')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LicensedBusinessUnitsController {
  constructor(private service: LicensedBusinessUnitsService) {}

  @Get()
  @RequirePermissions('licensed_business_units.view')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('divisionId') divisionId?: string,
    @Query('status') status?: BusinessUnitStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(user, companyId, divisionId, status, search, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('licensed_business_units.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('licensed_business_units.manage')
  create(@Body() dto: CreateLicensedBusinessUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('licensed_business_units.manage')
  update(@Param('id') id: string, @Body() dto: UpdateLicensedBusinessUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('licensed_business_units.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
