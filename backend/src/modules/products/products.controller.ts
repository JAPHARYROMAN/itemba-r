import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { QueryProductFamilyDto } from './dto/query-product-family.dto';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @RequireAnyPermissions(
    'products.view',
    'pos.create',
    'sales.create',
    'purchases.create',
    'inventory.view',
    'inventory.adjustments.create',
    'operations.dashboard.view',
  )
  findAll(@Query() query: QueryProductDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('families')
  @RequireAnyPermissions('products.view', 'operations.dashboard.view')
  findFamilies(@Query() query: QueryProductFamilyDto, @CurrentUser() user: AuthUser) {
    return this.service.findFamilies(query, user);
  }

  @Get(':id')
  @RequireAnyPermissions(
    'products.view',
    'pos.create',
    'sales.create',
    'purchases.create',
    'inventory.view',
    'inventory.adjustments.create',
    'operations.dashboard.view',
  )
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('products.create')
  create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('products.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
