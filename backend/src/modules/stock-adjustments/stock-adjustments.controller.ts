import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { UpdateStockAdjustmentDto } from './dto/update-stock-adjustment.dto';
import { QueryStockAdjustmentDto } from './dto/query-stock-adjustment.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('stock-adjustments')
export class StockAdjustmentsController {
  constructor(private readonly service: StockAdjustmentsService) {}

  @Get()
  @RequirePermissions('inventory.adjustments.create')
  findAll(@Query() query: QueryStockAdjustmentDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('inventory.adjustments.create')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('inventory.adjustments.create')
  create(@Body() dto: CreateStockAdjustmentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('inventory.adjustments.create')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStockAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/submit')
  @RequirePermissions('inventory.adjustments.create')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('inventory.adjustments.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Patch(':id/reject')
  @RequirePermissions('inventory.adjustments.approve')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, user);
  }

  @Patch(':id/post')
  @RequirePermissions('inventory.adjustments.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.post(id, user);
  }

  @Delete(':id')
  @RequirePermissions('inventory.adjustments.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
