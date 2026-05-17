import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { QuerySalesOrderDto } from './dto/query-sales-order.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) {}

  @Get()
  @RequirePermissions('sales.view')
  findAll(@Query() query: QuerySalesOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('receipt-accounts')
  @RequirePermissions('sales.create')
  findReceiptAccounts(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findReceiptAccounts(query, user);
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
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalesOrderDto,
    @CurrentUser() user: AuthUser,
  ) {
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
