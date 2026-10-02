import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SupplierPaymentsService } from './supplier-payments.service';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { QuerySupplierPaymentDto } from './dto/query-supplier-payment.dto';
import { ReverseSupplierPaymentDto } from './dto/reverse-supplier-payment.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';

@Controller('supplier-payments')
export class SupplierPaymentsController {
  constructor(private readonly service: SupplierPaymentsService) {}

  @Get()
  @RequirePermissions('supplier-payments.view')
  findAll(@Query() query: QuerySupplierPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('supplier-payments.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @AgentExcluded()
  @RequirePermissions('supplier-payments.manage')
  create(@Body() dto: CreateSupplierPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id/reverse')
  @AgentExcluded()
  @RequirePermissions('supplier-payments.manage')
  reverse(
    @Param('id') id: string,
    @Body() dto: ReverseSupplierPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reverse(id, dto, user);
  }
}
