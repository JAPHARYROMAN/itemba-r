import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CustomerPaymentsService } from './customer-payments.service';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto';
import { QueryCustomerPaymentDto } from './dto/query-customer-payment.dto';
import { ReverseCustomerPaymentDto } from './dto/reverse-customer-payment.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('customer-payments')
export class CustomerPaymentsController {
  constructor(private readonly service: CustomerPaymentsService) {}

  @Get()
  @RequirePermissions('customer-payments.view')
  findAll(@Query() query: QueryCustomerPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('customer-payments.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('customer-payments.manage')
  create(@Body() dto: CreateCustomerPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id/reverse')
  @RequirePermissions('customer-payments.manage')
  reverse(
    @Param('id') id: string,
    @Body() dto: ReverseCustomerPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reverse(id, dto, user);
  }
}
