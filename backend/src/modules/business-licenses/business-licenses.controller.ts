import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { BusinessLicensesService } from './business-licenses.service';
import { CreateBusinessLicenseDto } from './dto/create-business-license.dto';
import { UpdateBusinessLicenseDto } from './dto/update-business-license.dto';
import { RenewBusinessLicenseDto } from './dto/renew-business-license.dto';
import { BusinessLicenseStatus, BusinessLicenseType } from '@prisma/client';

@Controller('business-licenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BusinessLicensesController {
  constructor(private service: BusinessLicensesService) {}

  @Get('expiring')
  @RequirePermissions('business_licenses.view')
  findExpiring(
    @Query('companyId') companyId?: string,
    @Query('daysAhead') daysAhead?: string,
  ) {
    return this.service.findExpiring(companyId, daysAhead ? +daysAhead : 30);
  }

  @Get()
  @RequirePermissions('business_licenses.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('divisionId') divisionId?: string,
    @Query('licensedBusinessUnitId') licensedBusinessUnitId?: string,
    @Query('status') status?: BusinessLicenseStatus,
    @Query('licenseType') licenseType?: BusinessLicenseType,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(companyId, divisionId, licensedBusinessUnitId, status, licenseType, search, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('business_licenses.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('business_licenses.manage')
  create(@Body() dto: CreateBusinessLicenseDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('business_licenses.manage')
  update(@Param('id') id: string, @Body() dto: UpdateBusinessLicenseDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/renew')
  @RequirePermissions('business_licenses.renew')
  renew(@Param('id') id: string, @Body() dto: RenewBusinessLicenseDto, @CurrentUser() user: AuthUser) {
    return this.service.renew(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('business_licenses.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
