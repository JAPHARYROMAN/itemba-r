import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RentInvoicesService } from './rent-invoices.service';
import { CreateRentInvoiceDto } from './dto/create-rent-invoice.dto';
import { UpdateRentInvoiceDto } from './dto/update-rent-invoice.dto';

@Controller('rent-invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RentInvoicesController {
  constructor(private service: RentInvoicesService) {}

  @Get()
  @RequirePermissions('rent_invoices.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('propertyId') propertyId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('leaseAgreementId') leaseAgreementId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(companyId, propertyId, tenantId, leaseAgreementId, status, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequirePermissions('rent_invoices.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('rent_invoices.create')
  create(@Body() dto: CreateRentInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('rent_invoices.create')
  update(@Param('id') id: string, @Body() dto: UpdateRentInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/issue')
  @RequirePermissions('rent_invoices.issue')
  issue(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.issue(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('rent_invoices.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
