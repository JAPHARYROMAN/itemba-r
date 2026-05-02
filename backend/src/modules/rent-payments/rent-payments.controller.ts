import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RentPaymentsService } from './rent-payments.service';
import { CreateRentPaymentDto } from './dto/create-rent-payment.dto';

@Controller('rent-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RentPaymentsController {
  constructor(private service: RentPaymentsService) {}

  @Get()
  @RequirePermissions('rent_payments.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('rentInvoiceId') rentInvoiceId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(companyId, rentInvoiceId, tenantId, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('rent_payments.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('rent_payments.create')
  create(@Body() dto: CreateRentPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('rent_payments.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
