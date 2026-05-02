import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AutomationRunsService } from './automation-runs.service';

@Controller('automation-runs')
export class AutomationRunsController {
  constructor(private readonly service: AutomationRunsService) {}

  @Get()
  @RequirePermissions('automation_runs.list')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('automation_runs.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('trigger')
  @RequirePermissions('automation_runs.trigger')
  trigger(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.trigger(dto, user);
  }

  @Get(':id/items')
  @RequirePermissions('automation_runs.view')
  getItems(@Param('id') id: string) {
    return this.service.getItems(id);
  }
}
