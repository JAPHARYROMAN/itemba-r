import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProductBatchesService } from './product-batches.service';
import { CreateProductBatchDto } from './dto/create-product-batch.dto';
import { UpdateProductBatchDto } from './dto/update-product-batch.dto';
import { QueryProductBatchDto } from './dto/query-product-batch.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/product-batches')
@Controller('westsides/product-batches')
export class ProductBatchesController {
  constructor(private readonly service: ProductBatchesService) {}

  @Post()
  @RequirePermissions('product_batches.manage')
  @ApiOperation({ summary: 'Create product batch' })
  create(@Body() dto: CreateProductBatchDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('product_batches.view')
  @ApiOperation({ summary: 'List product batches' })
  findAll(@Query() query: QueryProductBatchDto) {
    return this.service.findAll(query);
  }

  @Get('expiring')
  @RequirePermissions('product_batches.view')
  @ApiOperation({ summary: 'Batches expiring within 30 days' })
  findExpiring(@Query('companyId') companyId?: string) {
    return this.service.findExpiring(companyId);
  }

  @Get('expired')
  @RequirePermissions('product_batches.view')
  @ApiOperation({ summary: 'Expired batches' })
  findExpired(@Query('companyId') companyId?: string) {
    return this.service.findExpired(companyId);
  }

  @Get('product/:productId')
  @RequirePermissions('product_batches.view')
  @ApiOperation({ summary: 'Get batches for a product' })
  findByProduct(@Param('productId') productId: string) {
    return this.service.findByProduct(productId);
  }

  @Get(':id')
  @RequirePermissions('product_batches.view')
  @ApiOperation({ summary: 'Get product batch by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('product_batches.manage')
  @ApiOperation({ summary: 'Update product batch' })
  update(@Param('id') id: string, @Body() dto: UpdateProductBatchDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('product_batches.manage')
  @ApiOperation({ summary: 'Soft delete product batch' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
