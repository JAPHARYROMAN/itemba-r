import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { SystemMetricsService } from './system-metrics.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('system-metrics')
export class SystemMetricsController {
  constructor(private readonly service: SystemMetricsService) {}

  @Get()
  @RequirePermissions('system_metrics.view')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Post()
  @RequirePermissions('system_metrics.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }
}
