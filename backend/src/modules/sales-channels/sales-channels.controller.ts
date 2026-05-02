import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SalesChannelsService } from './sales-channels.service';
import { CreateSalesChannelDto } from './dto/create-sales-channel.dto';
import { UpdateSalesChannelDto } from './dto/update-sales-channel.dto';
import { QuerySalesChannelDto } from './dto/query-sales-channel.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/sales-channels')
@Controller('westsides/sales-channels')
export class SalesChannelsController {
  constructor(private readonly service: SalesChannelsService) {}

  @Post()
  @RequirePermissions('sales_channels.manage')
  @ApiOperation({ summary: 'Create sales channel' })
  create(@Body() dto: CreateSalesChannelDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('sales_channels.view')
  @ApiOperation({ summary: 'List sales channels' })
  findAll(@Query() query: QuerySalesChannelDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('sales_channels.view')
  @ApiOperation({ summary: 'Get sales channel by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('sales_channels.manage')
  @ApiOperation({ summary: 'Update sales channel' })
  update(@Param('id') id: string, @Body() dto: UpdateSalesChannelDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('sales_channels.manage')
  @ApiOperation({ summary: 'Soft delete sales channel' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
