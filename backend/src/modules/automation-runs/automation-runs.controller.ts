import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { AutomationRunsQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AutomationRunsService } from './automation-runs.service';
import { TriggerAutomationRunDto } from './dto/trigger-automation-run.dto';

@Controller('automation-runs')
export class AutomationRunsController {
  constructor(private readonly service: AutomationRunsService) {}

  @Get()
  @RequirePermissions('automation_runs.list')
  findAll(@Query() query: AutomationRunsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('automation_runs.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post('trigger')
  @RequirePermissions('automation_runs.trigger')
  trigger(@Body() dto: TriggerAutomationRunDto, @CurrentUser() user: AuthUser) {
    return this.service.trigger(dto, user);
  }

  @Get(':id/items')
  @RequirePermissions('automation_runs.view')
  getItems(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getItems(id, user);
  }
}
