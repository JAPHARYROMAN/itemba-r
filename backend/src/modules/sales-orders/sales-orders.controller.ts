import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { QuerySalesOrderDto } from './dto/query-sales-order.dto';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) {}

  @Get()
  @RequirePermissions('sales.view')
  findAll(@Query() query: QuerySalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('workbench-summary')
  @RequirePermissions('sales.view')
  workbenchSummary(@Query() query: QuerySalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.workbenchSummary(query, user);
  }

  @Get('customer-day-summary')
  @RequirePermissions('sales.view')
  customerDaySummary(@Query() query: QuerySalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.customerDaySummary(query, user);
  }

  @Get('receipt-accounts')
  @RequireAnyPermissions('pos.create', 'sales.create', 'receivables.manage')
  findReceiptAccounts(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findReceiptAccounts(query, user);
  }

  @Get('mobile-pos/bootstrap')
  @RequireAnyPermissions('pos.view', 'sales.create')
  mobilePosBootstrap(
    @Query('companyId') companyId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.mobilePosBootstrap(user, companyId);
  }

  @Post('mobile-pos/quick-sale')
  @RequireAnyPermissions('pos.create', 'sales.create')
  mobilePosQuickSale(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.mobilePosQuickSale(dto, user);
  }

  @Get(':id/control-center')
  @RequirePermissions('sales.view')
  controlCenter(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.controlCenter(id, user);
  }

  @Get(':id/ledger')
  @RequirePermissions('sales.view')
  ledger(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.ledger(id, user);
  }

  @Get(':id/fulfillment')
  @RequirePermissions('sales.view')
  fulfillment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.fulfillment(id, user);
  }

  @Get(':id/profit')
  @RequirePermissions('sales.view')
  profit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.salesOrderProfit(id, user);
  }

  @Get(':id')
  @RequirePermissions('sales.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('sales.create')
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  /**
   * Quick Sale endpoint — single call that creates and confirms a sale in
   * one operator action. Powers the Westsides counter-sale flow.
   */
  @Post('quick-sale')
  @RequirePermissions('sales.create')
  quickSale(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.quickSale(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('sales.create')
  update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/confirm')
  @RequirePermissions('sales.confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.confirm(id, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('sales.cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user);
  }

  @Delete(':id')
  @RequirePermissions('sales.cancel')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
