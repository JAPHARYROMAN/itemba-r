import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { CompanyTaxRegistrationsService } from './company-tax-registrations.service';
import { CreateCompanyTaxRegistrationDto } from './dto/create-company-tax-registration.dto';
import { UpdateCompanyTaxRegistrationDto } from './dto/update-company-tax-registration.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tax/registrations')
export class CompanyTaxRegistrationsController {
  constructor(private readonly service: CompanyTaxRegistrationsService) {}

  @Get()
  @RequirePermissions('tax_registrations.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get('company/:companyId')
  @RequirePermissions('tax_registrations.view')
  findByCompany(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.findByCompany(companyId, user);
  }

  @Get(':id')
  @RequirePermissions('tax_registrations.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('tax_registrations.manage')
  create(@Body() dto: CreateCompanyTaxRegistrationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('tax_registrations.manage')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyTaxRegistrationDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('tax_registrations.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
