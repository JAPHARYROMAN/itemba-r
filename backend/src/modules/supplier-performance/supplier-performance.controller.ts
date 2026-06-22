import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SupplierPerformanceService } from './supplier-performance.service';
import { QuerySupplierPerformanceDto } from './dto/query-supplier-performance.dto';
import { UpsertSupplierPerformanceDto } from './dto/upsert-supplier-performance.dto';

@Controller('supplier-performance')
export class SupplierPerformanceController {
  constructor(private readonly service: SupplierPerformanceService) {}

  @Get()
  @RequirePermissions('supplier_performance.list')
  findAll(@Query() query: QuerySupplierPerformanceDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('supplier_performance.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('supplier_performance.create')
  create(@Body() dto: UpsertSupplierPerformanceDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('supplier_performance.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpsertSupplierPerformanceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }
}
