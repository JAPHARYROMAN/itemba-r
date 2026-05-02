import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { PerformanceTracesService } from './performance-traces.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('performance-traces')
export class PerformanceTracesController {
  constructor(private readonly service: PerformanceTracesService) {}

  @Get()
  @RequirePermissions('performance.traces.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('performance.traces.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Delete('purge-old')
  @RequirePermissions('performance.traces.manage')
  purgeOld(@CurrentUser() user: AuthUser) {
    return this.service.purgeOld(user.id);
  }

  @Post()
  @RequirePermissions('performance.traces.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }
}
