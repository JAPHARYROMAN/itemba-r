import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StockDamageService } from './stock-damage.service';
import { CreateStockDamageDto } from './dto/create-stock-damage.dto';
import { UpdateStockDamageDto } from './dto/update-stock-damage.dto';
import { QueryStockDamageDto } from './dto/query-stock-damage.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/stock-damage')
@Controller('westsides/stock-damage')
export class StockDamageController {
  constructor(private readonly service: StockDamageService) {}

  @Post()
  @RequirePermissions('stock_damage.create')
  @ApiOperation({ summary: 'Create stock damage record' })
  create(@Body() dto: CreateStockDamageDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('stock_damage.view')
  @ApiOperation({ summary: 'List stock damage records' })
  findAll(@Query() query: QueryStockDamageDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('stock_damage.view')
  @ApiOperation({ summary: 'Get stock damage record by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/submit')
  @RequirePermissions('stock_damage.create')
  @ApiOperation({ summary: 'Submit stock damage (DRAFT → SUBMITTED)' })
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user.id);
  }

  @Patch(':id/approve')
  @RequirePermissions('stock_damage.approve')
  @ApiOperation({ summary: 'Approve stock damage (SUBMITTED → APPROVED)' })
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Patch(':id/reject')
  @RequirePermissions('stock_damage.approve')
  @ApiOperation({ summary: 'Reject stock damage (SUBMITTED → REJECTED)' })
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, user.id);
  }

  @Patch(':id/post')
  @RequirePermissions('stock_damage.post')
  @ApiOperation({ summary: 'Post stock damage (APPROVED → POSTED, affects inventory)' })
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.post(id, user.id);
  }

  @Patch(':id')
  @RequirePermissions('stock_damage.create')
  @ApiOperation({ summary: 'Update stock damage (DRAFT only)' })
  update(@Param('id') id: string, @Body() dto: UpdateStockDamageDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('stock_damage.create')
  @ApiOperation({ summary: 'Soft delete stock damage (DRAFT only)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
