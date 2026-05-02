import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Patch } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { SalaryPaymentsService } from './salary-payments.service';
import { CreateSalaryPaymentDto } from './dto/create-salary-payment.dto';
import { UpdateSalaryPaymentDto } from './dto/update-salary-payment.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/salary-payments')
export class SalaryPaymentsController {
  constructor(private readonly service: SalaryPaymentsService) {}

  @Get()
  @RequirePermissions('salary_payments.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('salary_payments.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('salary_payments.create')
  create(@Body() dto: CreateSalaryPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('salary_payments.create')
  update(@Param('id') id: string, @Body() dto: UpdateSalaryPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/reverse')
  @RequirePermissions('salary_payments.reverse')
  reverse(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: AuthUser) {
    return this.service.reverse(id, body.reason, user);
  }

  @Delete(':id')
  @RequirePermissions('salary_payments.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
