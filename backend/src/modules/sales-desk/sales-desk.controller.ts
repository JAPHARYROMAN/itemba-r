import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SalesDeskService } from './sales-desk.service';
import {
  SalesCreateDto,
  SalesCustomerDto,
  SalesPaymentDto,
  SalesQuery,
  SalesVoidDto,
} from './sales-desk.dto';
@Controller('sales-desk')
@RequirePermissions('sales_desk.view')
export class SalesDeskController {
  constructor(private readonly service: SalesDeskService) {}
  @Get('directory') directory(@CurrentUser() u: AuthUser) {
    return this.service.directory(u);
  }
  @Get('customers') customers(@CurrentUser() u: AuthUser, @Query() q: SalesQuery) {
    return this.service.customers(u, q);
  }
  @Post('customers') @RequirePermissions('sales_desk.view', 'sales_desk.manage') customer(
    @CurrentUser() u: AuthUser,
    @Body() d: SalesCustomerDto,
  ) {
    return this.service.createCustomer(u, d);
  }
  @Get('overview') overview(@CurrentUser() u: AuthUser, @Query() q: SalesQuery) {
    return this.service.overview(u, q);
  }
  @Get('sales') list(@CurrentUser() u: AuthUser, @Query() q: SalesQuery) {
    return this.service.list(u, q);
  }
  @Get('sales/:id') detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(u, id);
  }
  @Post('sales') @RequirePermissions('sales_desk.view', 'sales_desk.manage') create(
    @CurrentUser() u: AuthUser,
    @Body() d: SalesCreateDto,
  ) {
    return this.service.create(u, d);
  }
  @Post('sales/:id/payments')
  @RequirePermissions(
    'sales_desk.view',
    'sales_desk.payments',
    'cash_desk.view',
    'cash_desk.record',
  )
  payment(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: SalesPaymentDto,
  ) {
    return this.service.payment(u, id, d);
  }
  @Post('sales/:id/void') @RequirePermissions('sales_desk.view', 'sales_desk.manage') void(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: SalesVoidDto,
  ) {
    return this.service.void(u, id, d);
  }
}
