import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { SalesDeskService } from './sales-desk.service';
import {
  SalesCreateDto,
  SalesCustomerDto,
  SalesPaymentDto,
  SalesQuery,
  SalesVoidDto,
} from './sales-desk.dto';
/**
 * `@AgentExcluded` — added by the ITEMBA OS redesign (4a155f19) and not yet
 * reviewed for agent eligibility. Every route here stays out of Msaidizi's tool
 * registry (fail closed) until it has reviewed positive evidence.
 */
@Controller('sales-desk')
@RequirePermissions('sales_desk.view')
@AgentExcluded()
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
