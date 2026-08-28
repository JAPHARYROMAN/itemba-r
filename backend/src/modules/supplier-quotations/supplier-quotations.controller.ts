import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { SupplierQuotationsQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SupplierQuotationsService } from './supplier-quotations.service';
import {
  CreateSupplierQuotationDto,
  UpdateSupplierQuotationDto,
} from './dto/supplier-quotation.dto';

@Controller('supplier-quotations')
export class SupplierQuotationsController {
  constructor(private readonly service: SupplierQuotationsService) {}

  @Get()
  @RequirePermissions('supplier_quotations.list')
  findAll(@Query() query: SupplierQuotationsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('supplier_quotations.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('supplier_quotations.create')
  create(@Body() dto: CreateSupplierQuotationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('supplier_quotations.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierQuotationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/accept')
  @RequirePermissions('supplier_quotations.accept')
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.accept(id, user);
  }

  @Post(':id/reject')
  @RequirePermissions('supplier_quotations.accept')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, user);
  }
}
