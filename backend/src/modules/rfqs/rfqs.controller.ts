import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RfqsService } from './rfqs.service';

@Controller('rfqs')
export class RfqsController {
  constructor(private readonly service: RfqsService) {}

  @Get()
  @RequirePermissions('rfqs.list')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('rfqs.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('rfqs.create')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('rfqs.update')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/send')
  @RequirePermissions('rfqs.send')
  send(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.send(id, dto, user);
  }
}
