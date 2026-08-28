import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PriceListsService } from './price-lists.service';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { QueryPriceListDto } from './dto/query-price-list.dto';
import {
  CreatePriceListItemStandaloneDto,
  UpdatePriceListItemDto,
} from './dto/price-list-item.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/price-lists')
@Controller('westsides/price-lists')
export class PriceListsController {
  constructor(private readonly service: PriceListsService) {}

  @Post()
  @RequirePermissions('price_lists.manage')
  @ApiOperation({ summary: 'Create price list' })
  create(@Body() dto: CreatePriceListDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('price_lists.view')
  @ApiOperation({ summary: 'List price lists' })
  findAll(@Query() query: QueryPriceListDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('price_lists.view')
  @ApiOperation({ summary: 'Get price list with items' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('price-list-items/:id')
  @RequirePermissions('price_lists.manage')
  @ApiOperation({ summary: 'Update price list item' })
  updateItem(
    @Param('id') id: string,
    @Body() dto: UpdatePriceListItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateItem(id, dto, user.id);
  }

  @Delete('price-list-items/:id')
  @RequirePermissions('price_lists.manage')
  @ApiOperation({ summary: 'Delete price list item' })
  removeItem(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeItem(id, user.id);
  }

  @Patch(':id/approve')
  @RequirePermissions('price_lists.approve')
  @ApiOperation({ summary: 'Approve price list' })
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Get(':id/items')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('price_lists.view')
  @ApiOperation({ summary: 'List items for a price list' })
  findItems(@Param('id') id: string) {
    return this.service.findItems(id);
  }

  @Post(':id/items')
  @RequirePermissions('price_lists.manage')
  @ApiOperation({ summary: 'Add item to price list' })
  addItem(
    @Param('id') id: string,
    @Body() dto: CreatePriceListItemStandaloneDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addItem(id, dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('price_lists.manage')
  @ApiOperation({ summary: 'Update price list' })
  update(@Param('id') id: string, @Body() dto: UpdatePriceListDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('price_lists.manage')
  @ApiOperation({ summary: 'Soft delete price list' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
